use crate::{interlude::*, utils};

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
    config: Arc<SerializedConfig>,
    hash_obj: HashObj,
    mod_instances: IndexMap<CHeapStr, (ModuleInstance, ModuleContext)>,
    old_lock_obj: Option<LockObj>,
    lockfile_path: PathBuf,
    hashfile_path: PathBuf,
    fresh_serialized: bool,
    hashfile_written: bool,
}

impl GhjkfileModules {
    async fn write_lockfile(&mut self) -> Res<()> {
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
        serialize_deno_ghjkfile(hcx, path).await?
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

async fn serialize_deno_ghjkfile(hcx: &HostCtx, path: &Path) -> Res<SerializationResult> {
    use denort::deno::deno_runtime;
    let main_module = deno_runtime::deno_core::resolve_path(
        hcx.gcx.repo_root.join("./files/deno/mod2.ts"),
        &hcx.config.cwd,
    )
    .wrap_err("error resolving main module")?;

    // let (stdout_r, stdout_w) = deno_runtime::deno_io::pipe()?;
    // let (stderr_r, stderr_w) = deno_runtime::deno_io::pipe()?;
    let mut worker = hcx
        .gcx
        .deno
        .prepare_module(
            main_module.clone(),
            deno_runtime::deno_permissions::PermissionsOptions {
                allow_env: Some(vec![]),
                allow_import: Some(vec![]),
                allow_read: Some(vec![]),
                allow_net: Some(vec![]),
                ..default()
            },
            deno_runtime::WorkerExecutionMode::Run,
            deno_runtime::deno_io::Stdio {
                // stdout: deno_runtime::deno_io::StdioPipe::file(stdout_w),
                // stderr: deno_runtime::deno_io::StdioPipe::file(stderr_w),
                ..default()
            },
        )
        .await?;

    let exit_code = worker.run().await?;
    info!(%exit_code, %main_module, "module done");
    for url in worker.get_visited_files().await {
        info!(%url, %main_module, "visited files");
    }
    Ok(todo!())
}

struct SerializationResult {
    config: SerializedConfig,
    accessed_env_keys: Vec<String>,
    read_file_paths: Vec<PathBuf>,
    listed_file_paths: Vec<PathBuf>,
}

type ModuleId = CHeapStr;

#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct ModuleConfig {
    pub id: ModuleId,
    pub config: serde_json::Value,
}

type ConfigBlackboard = serde_json::Map<String, serde_json::Value>;

#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct SerializedConfig {
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

#[derive(Debug, Serialize, Deserialize)]
pub struct HashObj {
    pub version: String,
    /// Hash of the ghjkfile contents.
    pub ghjkfile_hash: String,
    /// Hashes of all env vars that were read.
    pub env_var_hashes: indexmap::IndexMap<String, Option<String>>,
    /// Hashes of all files that were read.
    pub read_file_hashes: indexmap::IndexMap<PathBuf, Option<String>>,
    /// File paths that were observed from the fs but not necessarily
    /// read.
    pub listed_files: Vec<PathBuf>,
}

impl HashObj {
    /// The hash.json file stores the digests of all external accesses
    /// of a ghjkfile during serialization. The primary purpose is to
    /// do "cache invalidation" on ghjkfiles, re-serializing them if
    /// any of the digests change.
    pub async fn from_file(path: &Path) -> Res<HashObj> {
        let raw = tokio::fs::read(path)
            .await
            .wrap_err("error reading hash.json")?;
        serde_json::from_slice(&raw).wrap_err("error parsing hash.json")
    }

    pub async fn is_stale(&self, hcx: &HostCtx, ghjkfile_hash: &str) -> Res<bool> {
        if self.ghjkfile_hash != ghjkfile_hash {
            return Ok(true);
        }
        {
            let new_digest = env_var_digests(
                &hcx.config.env_vars,
                self.env_var_hashes.keys().map(|key| &key[..]),
            );
            if self.env_var_hashes != new_digest {
                return Ok(true);
            }
        }
        {
            for path in &self.listed_files {
                if !matches!(tokio::fs::try_exists(path).await, Ok(true)) {
                    return Ok(true);
                }
            }
        }
        {
            if self.read_file_hashes
                != file_digests(
                    &hcx,
                    self.read_file_hashes
                        .keys()
                        .map(|path| path.as_ref())
                        .collect(),
                )
                .await?
            {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

fn env_var_digests<'a>(
    all: &IndexMap<String, String>,
    accessed: impl Iterator<Item = &'a str>,
) -> IndexMap<String, Option<String>> {
    accessed
        .map(|key| {
            (
                key.to_owned(),
                match all.get(key) {
                    Some(val) => Some(utils::hash_str(val)),
                    None => None,
                },
            )
        })
        .collect()
}

async fn file_digests(
    hcx: &HostCtx,
    read_files: Vec<&Path>,
) -> Res<IndexMap<PathBuf, Option<String>>> {
    let out = read_files
        .into_co_stream()
        .map(|path| async move {
            let path = tokio::fs::canonicalize(path).await?;
            let hash = file_digest_hash(hcx, &path).await?;
            let relative_path = pathdiff::diff_paths(path, &hcx.config.cwd).unwrap();
            Ok((relative_path, hash))
        })
        .collect::<Res<Vec<_>>>()
        .await?;
    Ok(out.into_iter().collect())
}

async fn file_digest_hash(hcx: &HostCtx, path: &Path) -> Res<Option<String>> {
    let path = tokio::fs::canonicalize(path)
        .await
        .wrap_err("error resolving realpath")?;
    match tokio::fs::metadata(&path).await {
        Ok(stat) => {
            let content_hash = if stat.file_type().is_file() || stat.file_type().is_symlink() {
                Some(file_content_digest_hash(hcx, &path).await?)
            } else {
                None
            };

            Ok(Some(crate::utils::hash_obj(&serde_json::json!({
                "content_hash": content_hash,
                "stat": StatMeta::from(stat)
            }))))
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err).wrap_err("error on file stat"),
    }
}

async fn file_content_digest_hash(hcx: &HostCtx, path: &Path) -> Res<CHeapStr> {
    let path = tokio::fs::canonicalize(path)
        .await
        .wrap_err("error resolving realpath")?;
    use dashmap::mapref::entry::*;
    match hcx.file_hash_memo.entry(path.clone()) {
        Entry::Occupied(occupied_entry) => Ok(occupied_entry.get().clone()),
        Entry::Vacant(vacant_entry) => {
            // FIXME: optimize by stream hashing, this reads whole file into memory
            let file = tokio::fs::read(path)
                .await
                .wrap_err("error reading file for")?;
            let hash: CHeapStr = crate::utils::encode_base32_multibase(file).into();
            vacant_entry.insert(hash.clone());
            Ok(hash)
        }
    }
}

#[derive(Serialize)]
struct StatMeta {
    accessed: Option<u64>,
    created: Option<u64>,
    modified: Option<u64>,
    is_file: bool,
    is_dir: bool,
    is_symlink: bool,
    size: u64,
    #[cfg(unix)]
    mode: u32,
}

impl From<std::fs::Metadata> for StatMeta {
    fn from(value: std::fs::Metadata) -> Self {
        fn unwrap_opt_sys_time(inp: std::io::Result<std::time::SystemTime>) -> Option<u64> {
            inp.map_err(|_| ())
                .and_then(|ts| {
                    ts.duration_since(std::time::SystemTime::UNIX_EPOCH)
                        .map_err(|_| ())
                })
                .and_then(|dur| Ok(dur.as_secs()))
                .ok()
        }
        #[cfg(unix)]
        use std::os::unix::fs::PermissionsExt;

        Self {
            // file_type: match value.file_type() {},
            accessed: unwrap_opt_sys_time(value.accessed()),
            created: unwrap_opt_sys_time(value.created()),
            modified: unwrap_opt_sys_time(value.modified()),
            is_file: value.is_file(),
            is_symlink: value.is_symlink(),
            is_dir: value.is_dir(),
            size: value.len(),
            #[cfg(unix)]
            mode: value.permissions().mode(),
        }
    }
}
