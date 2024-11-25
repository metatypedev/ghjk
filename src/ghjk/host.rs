use crate::interlude::*;

mod deno;
mod hashfile;
use hashfile::*;

#[derive(educe::Educe)]
#[educe(Debug)]
enum ModuleManifest {
    Todo,
}

impl ModuleManifest {
    pub fn init(&self) -> ModuleInstance {
        ModuleInstance::Todo
    }
}
enum ModuleInstance {
    Todo,
}

type ModuleLockEntry = Box<dyn std::any::Any + Send + Sync + 'static>;
type ModuleContext = Box<dyn std::any::Any + Send + Sync + 'static>;

impl ModuleInstance {
    pub async fn load_lock_entry(
        &mut self,
        gcx: &GhjkCtx,
        raw: serde_json::Value,
    ) -> Res<ModuleLockEntry> {
        Ok(Box::new("todo"))
    }

    pub async fn gen_lock_entry(
        &mut self,
        gcx: &GhjkCtx,
        mcx: &ModuleContext,
    ) -> Res<serde_json::Value> {
        Ok(serde_json::json!("todo"))
    }

    pub async fn load_config(
        &mut self,
        gcx: &GhjkCtx,
        bb: &ConfigBlackboard,
        lock_entry: Option<ModuleLockEntry>,
    ) -> Res<ModuleContext> {
        Ok(Box::new("todo"))
    }
}

#[derive(Debug)]
pub struct Config {
    /// Discard serialization cache.
    pub re_serialize: bool,
    /// Discard any resolved values in lockfile.
    pub re_resolve: bool,
    /// Force use serialization cache.
    pub locked: bool,
    pub env_vars: IndexMap<String, String>,
    pub cwd: PathBuf,
}

#[derive(Debug)]
pub struct HostCtx {
    pub gcx: Arc<crate::GhjkCtx>,
    config: Config,
    pub modules: HashMap<ModuleId, ModuleManifest>,
    pub file_hash_memo: DHashMap<PathBuf, CHeapStr>,
}

impl HostCtx {
    pub fn new(gcx: Arc<crate::GhjkCtx>, config: Config) -> Self {
        Self {
            gcx,
            config,
            modules: [
                ("envs".into(), ModuleManifest::Todo),
                ("ports".into(), ModuleManifest::Todo),
                ("tasks".into(), ModuleManifest::Todo),
            ]
            .into_iter()
            .collect(),
            file_hash_memo: default(),
        }
    }
}

pub async fn modules_from_ghjkfile(hcx: Arc<HostCtx>) -> Res<Option<GhjkfileModules>> {
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
            Some(file_content_digest_hash(hcx.as_ref(), path).await?),
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
        for mod_conf in &lock_obj.config.modules {
            let Some(mod_man) = hcx.modules.get(&mod_conf.id) else {
                eyre::bail!(
                    "unrecognized module found in lockfile config: {:?}",
                    mod_conf.id
                );
            };
            let Some(mod_lock) = lock_obj.module_entries.swap_remove(&mod_conf.id) else {
                eyre::bail!(
                    "no lock entry found for module specified by lockfile config: {:?}",
                    mod_conf.id
                );
            };
            let mut mod_inst = mod_man.init();
            lock_entries.insert(
                mod_conf.id.clone(),
                mod_inst.load_lock_entry(&hcx.gcx, mod_lock).await?,
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
        serialize_ghjkfile(hcx.as_ref(), ghjkfile_path)
            .await
            .wrap_err("error serializing ghjkfile")?
    } else {
        if hcx.config.locked {
            unreachable!("code should have early exited");
        }
        return Ok(None);
    };

    let mod_instances = {
        let mut mod_instances = IndexMap::new();
        for mod_conf in &config.modules {
            let Some(mod_man) = hcx.modules.get(&mod_conf.id) else {
                eyre::bail!(
                    "unrecognized module specified by ghjkfile: {:?}",
                    mod_conf.id
                );
            };
            let mut mod_inst = mod_man.init();
            let mod_cx = mod_inst
                .load_config(
                    &hcx.gcx,
                    &config.blackboard,
                    lock_entries.remove(&mod_conf.id),
                )
                .await
                .wrap_err_with(|| format!("error loading module config: {:?}", mod_conf.id))?;
            mod_instances.insert(mod_conf.id.clone(), (mod_inst, mod_cx));
        }
        mod_instances
    };

    Ok(Some(GhjkfileModules {
        hcx,
        config,
        mod_instances,
        hash_obj,
        old_lock_obj: lock_obj,
        lockfile_path,
        hashfile_path,
        fresh_serialized,
        hashfile_written: false,
    }))
}

pub struct GhjkfileModules {
    hcx: Arc<HostCtx>,
    pub config: Arc<SerializedConfig>,
    hash_obj: HashObj,
    mod_instances: IndexMap<CHeapStr, (ModuleInstance, ModuleContext)>,
    old_lock_obj: Option<LockObj>,
    lockfile_path: PathBuf,
    hashfile_path: PathBuf,
    fresh_serialized: bool,
    hashfile_written: bool,
}

impl GhjkfileModules {
    pub async fn write_lockfile(&mut self) -> Res<()> {
        let mut lock_obj = LockObj {
            version: "0".into(),
            config: self.config.clone(),
            module_entries: default(),
        };
        // generate the lock entries after *all* the modules
        // are done processing their config to allow
        // any shared stores to be properly populated
        // e.g. the resolution memo store
        for (mod_id, (mod_inst, mcx)) in &mut self.mod_instances {
            let lock_entry = mod_inst
                .gen_lock_entry(&self.hcx.gcx, mcx)
                .await
                .wrap_err_with(|| {
                    format!("error generating lock entry for module: {:?}", mod_id)
                })?;
            lock_obj.module_entries.insert(mod_id.clone(), lock_entry);
        }

        if self.old_lock_obj.is_none()
            || matches!(self.old_lock_obj.as_ref(), Some(old) if !old.eq(&lock_obj))
        {
            if self.hcx.config.locked {
                warn!("locked flag set, changes to lockfile discarded");
            } else {
                tokio::fs::write(
                    &self.lockfile_path,
                    serde_json::to_vec_pretty(&lock_obj).expect_or_log("error jsonifying lockfile"),
                )
                .await
                .wrap_err("error writing to lockfile")?;
                self.old_lock_obj.replace(lock_obj);
            }
        }

        // Only write out hashfile when a fresh serialization
        // result was saved in the lock file.
        if self.fresh_serialized && !self.hashfile_written {
            if self.hcx.config.locked {
                unreachable!("code should have early exited");
            }
            tokio::fs::write(
                &self.lockfile_path,
                serde_json::to_vec_pretty(&self.hash_obj)
                    .expect_or_log("error jsonifying hashfile"),
            )
            .await
            .wrap_err("error writing to lockfile")?;
            self.hashfile_written = true;
        }
        Ok(())
    }
}

async fn serialize_ghjkfile(hcx: &HostCtx, path: &Path) -> Res<(Arc<SerializedConfig>, HashObj)> {
    let ext = path.extension();
    let res = if ext.map(|ext| ext == "ts" || ext == "js") == Some(true) {
        debug!("serializing deno ghjkfile");
        deno::serialize_deno_ghjkfile(hcx, path).await?
    } else {
        eyre::bail!("unrecognized ghjkfile extension: {path:?}")
    };
    Ok((
        Arc::new(res.config),
        HashObj {
            version: "0".into(),
            env_var_hashes: env_var_digests(
                &hcx.config.env_vars,
                res.accessed_env_keys.iter().map(|key| key.as_ref()),
            ),
            ghjkfile_hash: file_digest_hash(hcx, path).await?.unwrap(),
            listed_files: res
                .listed_file_paths
                .into_iter()
                .map(|path| pathdiff::diff_paths(path, &hcx.config.cwd).unwrap_or_log())
                .collect(),
            read_file_hashes: file_digests(
                hcx,
                res.read_file_paths
                    .iter()
                    .map(|path| path.as_ref())
                    .collect(),
            )
            .await?,
        },
    ))
}

struct SerializationResult {
    config: SerializedConfig,
    accessed_env_keys: Vec<String>,
    read_file_paths: Vec<PathBuf>,
    listed_file_paths: Vec<PathBuf>,
    loaded_modules: Vec<url::Url>,
}

type ModuleId = CHeapStr;

#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct ModuleConfig {
    pub id: ModuleId,
    pub config: serde_json::Value,
}

type ConfigBlackboard = serde_json::Map<String, serde_json::Value>;

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct SerializedConfig {
    modules: Vec<ModuleConfig>,
    blackboard: ConfigBlackboard,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct LockObj {
    pub version: String,
    pub module_entries: indexmap::IndexMap<CHeapStr, serde_json::Value>,
    pub config: Arc<SerializedConfig>,
}

impl LockObj {
    /// The lock.json file stores the serialized config and some entries
    /// from modules. It's primary purpose is as a memo store to avoid
    /// re-serialization on each CLI invocation.
    pub async fn from_file(path: &Path) -> Res<Self> {
        let raw = tokio::fs::read(path)
            .await
            .wrap_err("error reading hash.json")?;
        serde_json::from_slice(&raw).wrap_err("error parsing lock.json")
    }
}
