//! This module implements support for systems written in typescript
//! running on top of deno.

use crate::interlude::*;

use super::{SystemId, SystemInstance, SystemManifest};

#[derive(Clone)]
pub struct DenoSystemsContext {
    callbacks: crate::ext::CallbacksHandle,
    exit_code_channel: Arc<std::sync::Mutex<Option<tokio::task::JoinHandle<i32>>>>,
    term_signal: Arc<std::sync::atomic::AtomicBool>,
    #[allow(unused)]
    hostcalls: crate::ext::Hostcalls,
}

impl DenoSystemsContext {
    #[allow(unused)]
    pub async fn terminate(&mut self) -> Res<i32> {
        let channel = {
            let mut opt = self.exit_code_channel.lock().expect_or_log("mutex error");
            opt.take()
        };
        let Some(channel) = channel else {
            eyre::bail!("already terminated")
        };
        self.term_signal
            .store(true, std::sync::atomic::Ordering::Relaxed);
        Ok(channel.await.expect_or_log("channel error"))
    }
}

#[tracing::instrument(skip(gcx))]
pub async fn systems_from_deno(
    gcx: &GhjkCtx,
    source_uri: &url::Url,
) -> Res<HashMap<SystemId, SystemManifest>> {
    let main_module = gcx
        .repo_root
        .join("src/deno_systems/bindings.ts")
        .wrap_err("repo url error")?;

    let mut ext_conf = crate::ext::ExtConfig::new();

    let bb = ext_conf.blackboard.clone();
    bb.insert("args".into(), {
        #[derive(Serialize)]
        struct GhjkCtxBean<'a> {
            ghjkfile_path: Option<&'a Path>,
            ghjk_dir_path: &'a Path,
            share_dir_path: &'a Path,
        }

        #[derive(Serialize)]
        struct BindingArgs<'a> {
            uri: url::Url,
            gcx: GhjkCtxBean<'a>,
        }
        let GhjkCtx {
            deno,
            repo_root,
            ghjkfile_path,
            ghjk_dir_path,
            share_dir_path,
        } = gcx;
        _ = (deno, repo_root);

        serde_json::json!(BindingArgs {
            uri: source_uri.clone(),
            gcx: GhjkCtxBean {
                ghjkfile_path: ghjkfile_path.as_ref().map(|path| path.as_path()),
                ghjk_dir_path,
                share_dir_path,
            },
        })
    });
    let hostcalls = ext_conf.hostcalls.clone();

    let (manifests_tx, mut manifests_rx) = tokio::sync::mpsc::channel(1);
    hostcalls.funcs.insert(
        "register_systems".into(),
        Box::new(move |args| {
            let tx = manifests_tx.clone();
            async move {
                tx.send(args).await.expect_or_log("channel error");
                Ok(serde_json::Value::Null)
            }
            .boxed()
        }),
    );
    let cb_line = ext_conf.callbacks_handle();

    let mut worker = gcx
        .deno
        .prepare_module(
            main_module,
            deno_runtime::deno_permissions::PermissionsOptions {
                allow_env: Some(vec![]),
                allow_import: Some(vec![]),
                allow_read: Some(vec![]),
                allow_net: Some(vec![]),
                allow_ffi: Some(vec![]),
                allow_run: Some(vec![]),
                allow_sys: Some(vec![]),
                allow_write: Some(vec![]),
                allow_all: true,
                prompt: false,
                ..default()
            },
            deno_runtime::WorkerExecutionMode::Run,
            default(),
            Some(crate::ext::extensions(ext_conf)),
        )
        .await?;
    worker.execute().await?;
    let (exit_code_channel, term_signal, _) = worker.drive_till_exit().await?;

    let join_exit_code_watcher = tokio::spawn(async {
        let exit_code = exit_code_channel
            .await
            .expect_or_log("channel error")
            .wrap_err("error on event loop for deno systems")
            .unwrap_or_log();
        if exit_code != 0 {
            // TODO: exit signals
            error!(%exit_code, "deno systems died with non-zero exit code");
        } else {
            info!(%exit_code, "deno systems exit")
        }
        exit_code
    });
    let exit_code_channel = Arc::new(std::sync::Mutex::new(Some(join_exit_code_watcher)));

    let scx = DenoSystemsContext {
        callbacks: cb_line,
        hostcalls,
        term_signal,
        exit_code_channel,
    };
    let scx = Arc::new(scx);

    let manifests = manifests_rx.recv().await.expect_or_log("channel error");
    let manifests: Vec<ManifestDesc> =
        serde_json::from_value(manifests).wrap_err("protocol error")?;
    let manifests = manifests
        .into_iter()
        .map(|desc| {
            (
                desc.id.clone(),
                SystemManifest::Deno(DenoSystemManifest {
                    desc,
                    scx: scx.clone(),
                }),
            )
        })
        .collect();

    Ok(manifests)
}

#[derive(Debug, Deserialize)]
struct ManifestDesc {
    id: SystemId,
    ctor_cb_key: CHeapStr,
}

#[derive(educe::Educe)]
#[educe(Debug)]
pub struct DenoSystemManifest {
    desc: ManifestDesc,
    #[educe(Debug(ignore))]
    scx: Arc<DenoSystemsContext>,
}

impl DenoSystemManifest {
    pub async fn ctor(&self) -> Res<DenoSystemInstance> {
        debug!(id = %self.desc.id, "initializing deno system");
        let desc = self
            .scx
            .callbacks
            .exec(self.desc.ctor_cb_key.clone(), serde_json::Value::Null)
            .await?;

        let desc = serde_json::from_value(desc).wrap_err("protocol error")?;

        debug!(id = %self.desc.id, "deno system initialized");

        Ok(DenoSystemInstance {
            desc,
            scx: self.scx.clone(),
        })
    }
}

#[derive(Debug, Deserialize)]
/// This is the description sent from the typescript side for a registered manifest.
struct InstanceDesc {
    load_lock_entry_cb_key: CHeapStr,
    gen_lock_entry_cb_key: CHeapStr,
    load_config_cb_key: CHeapStr,
}

pub struct DenoSystemInstance {
    desc: InstanceDesc,
    scx: Arc<DenoSystemsContext>,
}

#[async_trait::async_trait]
impl SystemInstance for DenoSystemInstance {
    type LockState = serde_json::Value;

    async fn load_config(
        &self,
        config: serde_json::Value,
        bb: Arc<serde_json::Map<String, serde_json::Value>>,
        state: Option<Self::LockState>,
    ) -> Res<()> {
        self.scx
            .callbacks
            .exec(
                self.desc.load_config_cb_key.clone(),
                serde_json::json!({
                    "config": config,
                    "bb": bb,
                    "state": state
                }),
            )
            .await
            .wrap_err("callback error")?;
        Ok(())
    }

    async fn load_lock_entry(&self, raw: serde_json::Value) -> Res<Self::LockState> {
        self.scx
            .callbacks
            .exec(
                self.desc.load_lock_entry_cb_key.clone(),
                serde_json::json!({
                    "raw": raw
                }),
            )
            .await
            .wrap_err("callback error")
    }

    async fn gen_lock_entry(&self) -> Res<serde_json::Value> {
        self.scx
            .callbacks
            .exec(
                self.desc.gen_lock_entry_cb_key.clone(),
                serde_json::json!({}),
            )
            .await
            .wrap_err("callback error")
    }
}
