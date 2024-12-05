use crate::interlude::*;

use crate::systems::*;

mod deno;
mod hashfile;

use hashfile::HashObj;

#[derive(Debug)]
pub struct Config {
    /// Discard serialization cache.
    pub re_serialize: bool,
    /// Discard any resolved values in lockfile.
    #[allow(unused)]
    pub re_resolve: bool,
    /// Force use serialization cache.
    pub locked: bool,
    pub env_vars: IndexMap<String, String>,
    pub cwd: PathBuf,
}

#[derive(educe::Educe)]
#[educe(Debug)]
pub struct HostCtx {
    pub gcx: Arc<crate::GhjkCtx>,
    pub config: Config,
    #[educe(Debug(ignore))]
    pub systems: HashMap<SystemId, SystemManifest>,
    pub file_hash_memo: DHashMap<PathBuf, hashfile::SharedFileContentDigestFuture>,
}

impl HostCtx {
    pub fn new(
        gcx: Arc<crate::GhjkCtx>,
        config: Config,
        systems: HashMap<SystemId, SystemManifest>,
    ) -> Self {
        Self {
            gcx,
            config,
            systems,
            file_hash_memo: default(),
        }
    }
}

#[tracing::instrument(skip(hcx))]
pub async fn systems_from_ghjkfile(hcx: Arc<HostCtx>) -> Res<Option<GhjkfileSystems>> {
    let (hashfile_path, lockfile_path) = (
        hcx.gcx.ghjk_dir_path.join("hash.json"),
        hcx.gcx.ghjk_dir_path.join("lock.json"),
    );

    let (hash_obj, lock_obj) = (
        HashObj::from_file(&hashfile_path),
        LockObj::from_file(&lockfile_path),
    )
        .join()
        .await;

    let (mut hash_obj, mut lock_obj) = (
        hash_obj.inspect_err(|err| warn!("{err}")).ok(),
        lock_obj.inspect_err(|err| warn!("{err}")).ok(),
    );

    if hcx.config.locked {
        if hash_obj.is_none() {
            eyre::bail!("locked flag is set but no hashfile found");
        }
        if lock_obj.is_none() {
            eyre::bail!("locked flag is set but no lockfile found");
        }
    }

    let (ghjkfile_exists, ghjkfile_hash) = if let Some(path) = &hcx.gcx.ghjkfile_path {
        (
            matches!(tokio::fs::try_exists(path).await, Ok(true)),
            Some(
                hashfile::file_content_digest_hash(hcx.as_ref(), path)
                    .await?
                    .await
                    .map_err(|err| ferr!(err))?,
            ),
        )
    } else {
        (false, None)
    };

    // check if we need to discard the hashfile
    if let Some(obj) = &mut hash_obj {
        // TODO: version migrator
        if obj.version != "0" {
            eyre::bail!("unsupported hashfile version: {:?}", obj.version);
        }
        if !hcx.config.locked
            && (hcx.config.re_serialize
                || ghjkfile_hash.is_none()
                || obj
                    .is_stale(hcx.as_ref(), ghjkfile_hash.as_ref().unwrap())
                    .await?)
        {
            hash_obj = None;
        }
    }
    // check if we need to discard the lockfile
    if let Some(obj) = &mut lock_obj {
        // TODO: version migrator
        if obj.version != "0" {
            eyre::bail!("unsupported hashfile version: {:?}", obj.version);
        }
        // if obj.version != "0" {
        //     hash_obj = None;
        // }
    }
    // TODO:
    // if hcx.re_resolve {}

    let mut lock_entries = HashMap::new();

    if let Some(lock_obj) = &mut lock_obj {
        debug!(?lockfile_path, "loading lockfile");
        for sys_conf in &lock_obj.config.modules {
            let Some(sys_man) = hcx.systems.get(&sys_conf.id) else {
                eyre::bail!(
                    "unrecognized system found in lockfile config: {:?}",
                    sys_conf.id
                );
            };
            let Some(sys_lock) = lock_obj.sys_entries.swap_remove(&sys_conf.id) else {
                eyre::bail!(
                    "no lock entry found for system specified by lockfile config: {:?}",
                    sys_conf.id
                );
            };
            let sys_inst = sys_man.init().await?;
            lock_entries.insert(
                sys_conf.id.clone(),
                sys_inst.load_lock_entry(sys_lock).await?,
            );
        }
    }

    let mut fresh_serialized = false;

    let (config, hash_obj) = if let (Some(lock_obj), Some(hash_obj)) = (&lock_obj, hash_obj) {
        // Only recover the old config if the hash_obj and lock_obj haven't
        // been discarded by the cache invalidation checks above.
        // Assumes that a hashfile tags the specific serialized version of the ghjkfile
        // and it's context put in the lockfile
        (lock_obj.config.clone(), hash_obj)
    } else if let Some(ghjkfile_path) = &hcx.gcx.ghjkfile_path {
        if !ghjkfile_exists {
            eyre::bail!("no file found at ghjkfile path {ghjkfile_path:?}");
        }
        if hcx.config.locked {
            unreachable!("code should have early exited");
        }
        info!(?ghjkfile_path, "serializing ghjkfile");
        fresh_serialized = true;
        // TODO: configurable timeout on serialization
        serialize_ghjkfile(hcx.as_ref(), ghjkfile_path)
            .await
            .wrap_err("error serializing ghjkfile")?
    } else {
        if hcx.config.locked {
            unreachable!("code should have early exited");
        }
        return Ok(None);
    };

    debug!("initializing ghjkfile systems");
    let sys_instances = {
        let mut sys_instances = IndexMap::new();
        for sys_conf in &config.modules {
            let Some(sys_man) = hcx.systems.get(&sys_conf.id) else {
                eyre::bail!(
                    "unrecognized system specified by ghjkfile: {:?}",
                    sys_conf.id
                );
            };
            let sys_inst = sys_man.init().await?;
            sys_inst
                .load_config(
                    sys_conf.config.clone(),
                    config.blackboard.clone(),
                    lock_entries.remove(&sys_conf.id),
                )
                .await
                .wrap_err_with(|| format!("error loading system config: {:?}", sys_conf.id))?;
            sys_instances.insert(sys_conf.id.clone(), sys_inst);
        }
        sys_instances
    };

    Ok(Some(GhjkfileSystems {
        hcx,
        config,
        sys_instances,
        hash_obj,
        old_lock_obj: lock_obj,
        lockfile_path,
        hashfile_path,
        fresh_serialized,
        hashfile_written: false,
    }))
}

pub struct GhjkfileSystems {
    hcx: Arc<HostCtx>,
    pub config: Arc<SerializedConfig>,
    hash_obj: HashObj,
    pub sys_instances: IndexMap<CHeapStr, ErasedSystemInstance>,
    old_lock_obj: Option<LockObj>,
    lockfile_path: PathBuf,
    hashfile_path: PathBuf,
    fresh_serialized: bool,
    hashfile_written: bool,
}

impl GhjkfileSystems {
    pub async fn write_lockfile_or_log(&mut self) {
        if let Err(err) = self.write_lockfile().await {
            error!("error writing lockfile: {err}");
        }
    }

    #[tracing::instrument(skip(self))]
    pub async fn write_lockfile(&mut self) -> Res<()> {
        let mut lock_obj = LockObj {
            version: "0".into(),
            config: self.config.clone(),
            sys_entries: default(),
        };
        // generate the lock entries after *all* the systems
        // are done processing their config to allow
        // any shared stores to be properly populated
        // e.g. the resolution memo store
        for (sys_id, sys_inst) in &mut self.sys_instances {
            let lock_entry = sys_inst.gen_lock_entry().await.wrap_err_with(|| {
                format!("error generating lock entry for system: {:?}", sys_id)
            })?;
            lock_obj.sys_entries.insert(sys_id.clone(), lock_entry);
        }

        if self.old_lock_obj.is_none()
            || matches!(self.old_lock_obj.as_ref(), Some(old) if !old.eq(&lock_obj))
        {
            if self.hcx.config.locked {
                warn!("locked flag set, changes to lockfile discarded");
            } else {
                trace!(lockfile_path = ?self.lockfile_path, /* ?lock_obj, */ "writing lock.json");
                /* tokio::fs::write(
                    &self.lockfile_path,
                    serde_json::to_vec_pretty(&lock_obj).expect_or_log("error jsonifying lockfile"),
                )
                .await
                .wrap_err("error writing to lockfile")?; */
                self.old_lock_obj.replace(lock_obj);
            }
        }

        // Only write out hashfile when a fresh serialization
        // result was saved in the lock file.
        if self.fresh_serialized && !self.hashfile_written {
            if self.hcx.config.locked {
                unreachable!("code should have early exited");
            }
            trace!(hashfile_path = ?self.hashfile_path, /* hash_obj= ?self.hash_obj, */ "writing hash.json");
            /* tokio::fs::write(
                &self.hashfile_path,
                serde_json::to_vec_pretty(&self.hash_obj)
                    .expect_or_log("error jsonifying hashfile"),
            )
            .await
            .wrap_err("error writing to lockfile")?; */
            self.hashfile_written = true;
        }
        Ok(())
    }
}

async fn serialize_ghjkfile(hcx: &HostCtx, path: &Path) -> Res<(Arc<SerializedConfig>, HashObj)> {
    let ext = path.extension();
    let res = if ext.map(|ext| ext == "ts" || ext == "js") == Some(true) {
        deno::serialize_deno_ghjkfile(hcx, path).await?
    } else {
        eyre::bail!("unrecognized ghjkfile extension: {path:?}")
    };
    debug!("ghjkfile serialized");
    let hash_obj = HashObj::from_result(hcx, path, &res)
        .await
        .wrap_err("error building hash obj")?;
    Ok((Arc::new(res.config), hash_obj))
}

#[derive(Debug)]
struct SerializationResult {
    config: SerializedConfig,
    accessed_env_keys: Vec<String>,
    read_file_paths: Vec<PathBuf>,
    listed_file_paths: Vec<PathBuf>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct SerializedConfig {
    modules: Vec<SystemConfig>,
    blackboard: ConfigBlackboard,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct LockObj {
    pub version: String,
    pub sys_entries: indexmap::IndexMap<CHeapStr, serde_json::Value>,
    pub config: Arc<SerializedConfig>,
}

impl LockObj {
    /// The lock.json file stores the serialized config and some entries
    /// from systems. It's primary purpose is as a memo store to avoid
    /// re-serialization on each CLI invocation.
    pub async fn from_file(path: &Path) -> Res<Self> {
        let raw = tokio::fs::read(path)
            .await
            .wrap_err("error reading hash.json")?;
        serde_json::from_slice(&raw).wrap_err("error parsing lock.json")
    }
}