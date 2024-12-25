//! This module implements support for systems written in typescript
//! running on top of deno.

use crate::interlude::*;

use super::{SystemCliCommand, SystemId, SystemInstance, SystemManifest};

mod cli;

#[derive(Clone)]
pub struct DenoSystemsContext {
    callbacks: crate::ext::CallbacksHandle,
    exit_code_channel: Arc<std::sync::Mutex<Option<tokio::task::JoinHandle<Res<()>>>>>,
    term_signal: tokio::sync::watch::Sender<bool>,
    #[allow(unused)]
    hostcalls: crate::ext::Hostcalls,
}

impl DenoSystemsContext {
    #[allow(unused)]
    pub async fn terminate(mut self) -> Res<()> {
        let channel = {
            let mut opt = self.exit_code_channel.lock().expect_or_log("mutex error");
            opt.take()
        };
        let Some(channel) = channel else {
            eyre::bail!("already terminated")
        };
        self.term_signal.send(true).expect_or_log("channel error");
        channel.await.expect_or_log("channel error")
    }
}

#[tracing::instrument(skip(gcx))]
pub async fn systems_from_deno(
    gcx: &GhjkCtx,
    source_uri: &url::Url,
    ghjkdir_path: &Path,
) -> Res<(HashMap<SystemId, SystemManifest>, DenoSystemsContext)> {
    let main_module = gcx
        .config
        .repo_root
        .join("src/deno_systems/bindings.ts")
        .wrap_err("repo url error")?;

    let mut ext_conf = crate::ext::ExtConfig::new();

    let bb = ext_conf.blackboard.clone();
    bb.insert("args".into(), {
        #[derive(Serialize)]
        struct ConfigRef<'a> {
            pub ghjkfile: Option<&'a Path>,
            pub ghjkdir: &'a Path,
            pub data_dir: &'a Path,
            pub deno_dir: &'a Path,
            pub deno_lockfile: Option<&'a Path>,
            pub repo_root: &'a url::Url,
        }

        #[derive(Serialize)]
        struct BindingArgs<'a> {
            uri: url::Url,
            config: ConfigRef<'a>,
        }
        let crate::config::Config {
            repo_root,
            ghjkdir: _,
            data_dir,
            deno_lockfile,
            ghjkfile,
            deno_dir,
        } = &gcx.config;

        serde_json::json!(BindingArgs {
            uri: source_uri.clone(),
            config: ConfigRef {
                ghjkfile: ghjkfile.as_ref().map(|path| path.as_path()),
                ghjkdir: ghjkdir_path,
                data_dir,
                deno_lockfile: deno_lockfile.as_ref().map(|path| path.as_path()),
                deno_dir,
                repo_root
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
    let cb_line = ext_conf.callbacks_handle(&gcx.deno);

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
    let (mut exit_code_channel, term_signal, _) = worker.drive_till_exit().await?;

    let manifests = tokio::select! {
        res = &mut exit_code_channel => {
            let exit_code = res
                .expect_or_log("channel error")
                .wrap_err("deno systems error building manifests")?;
            eyre::bail!("premature exit of deno systems before manifests were sent: exit code = {exit_code}");
        },
        manifests = manifests_rx.recv() => {
            manifests.expect_or_log("channel error")
        }
    };

    let manifests: Vec<ManifestDesc> =
        serde_json::from_value(manifests).wrap_err("protocol error")?;

    let dcx = gcx.deno.clone();
    let join_exit_code_watcher = tokio::spawn(async {
        let err = match exit_code_channel.await {
            Ok(Ok(0)) => return Ok(()),
            Ok(Ok(exit_code)) => {
                ferr!("deno systems died with non-zero exit code: {exit_code}")
            }
            Ok(Err(err)) => err.wrap_err("error on event loop for deno systems"),
            Err(_) => {
                ferr!("deno systems unexpected shutdown")
            }
        };
        error!("deno systems error: {err:?}");
        dcx.terminate()
            .await
            .expect_or_log("error terminating deno worker");
        Err(err)
    });

    let exit_code_channel = Arc::new(std::sync::Mutex::new(Some(join_exit_code_watcher)));

    let scx = DenoSystemsContext {
        callbacks: cb_line,
        hostcalls,
        term_signal,
        exit_code_channel,
    };

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

    Ok((manifests, scx))
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
    scx: DenoSystemsContext,
}

impl DenoSystemManifest {
    #[tracing::instrument]
    pub async fn ctor(&self) -> Res<DenoSystemInstance> {
        trace!("initializing deno system");
        let desc = self
            .scx
            .callbacks
            .exec(self.desc.ctor_cb_key.clone(), serde_json::Value::Null)
            .await?;

        let desc = serde_json::from_value(desc).wrap_err("protocol error")?;

        trace!("deno system initialized");

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
    cli_commands_cb_key: CHeapStr,
}

pub struct DenoSystemInstance {
    desc: InstanceDesc,
    scx: DenoSystemsContext,
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

    async fn commands(&self) -> Res<Vec<SystemCliCommand>> {
        let cmds = self
            .scx
            .callbacks
            .exec(self.desc.cli_commands_cb_key.clone(), serde_json::json!({}))
            .await
            .wrap_err("callback error")?;

        let cmds: Vec<cli::CliCommandDesc> =
            serde_json::from_value(cmds).wrap_err("protocol error")?;

        let cmds = cmds
            .into_iter()
            .map(|cmd| cmd.into_clap(self.scx.clone()))
            .collect();

        Ok(cmds)
    }
}
