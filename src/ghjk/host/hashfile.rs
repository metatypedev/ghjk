use crate::interlude::*;

use super::HostCtx;

#[derive(Debug, Serialize, Deserialize)]
pub struct HashObj {
    pub version: String,
    /// The cli config used during serialization
    pub cli_config: crate::config::Config,
    // we store the deno.json file directly instead of hashing it
    pub deno_config: Option<serde_json::Value>,
    /// Hashes of all env vars that were read.
    pub env_var_hashes: indexmap::IndexMap<String, Option<String>>,
    /// Hashes of all files that were read.
    pub read_file_hashes: indexmap::IndexMap<PathBuf, Option<String>>,
    /// File paths that were observed from the fs but not necessarily
    /// read.
    pub listed_files: Vec<PathBuf>,
}

#[derive(Debug, thiserror::Error)]
pub enum HashfileError {
    #[error("error parsing hashfile: {0}")]
    Serialization(serde_json::Error),
    #[error("{0}")]
    Other(#[source] eyre::Report),
}

impl HashObj {
    #[tracing::instrument(skip(hcx, res))]
    pub async fn from_result(
        hcx: &super::HostCtx,
        ghjkfile_path: &Path,
        res: &super::SerializationResult,
    ) -> Res<Self> {
        Ok(HashObj {
            version: "0".into(),
            env_var_hashes: env_var_digests(
                &hcx.config.env_vars,
                res.accessed_env_keys.iter().map(|key| key.as_ref()),
            ),
            listed_files: res
                .listed_file_paths
                .iter()
                .map(|path| {
                    pathdiff::diff_paths(
                        std::path::absolute(path).expect_or_log("error absolutizing path"),
                        &hcx.config.cwd,
                    )
                    .unwrap_or_log()
                })
                .collect(),
            read_file_hashes: file_digests(
                hcx,
                res.read_file_paths
                    .iter()
                    .map(|path| path.as_ref())
                    .collect(),
            )
            .await?,
            cli_config: hcx.gcx.config.clone(),
            deno_config: if let Some(path) = hcx.gcx.config.deno_json.as_ref() {
                let raw = read_file(path)
                    .await
                    .map_err(|err| ferr!("error reading deno.json at {path:?}: {err}"))?
                    .ok_or_else(|| ferr!("error reading deno.json at {path:?}: file not found"))?;
                let string = std::str::from_utf8(&raw[..])
                    .map_err(|err| ferr!("utf8 error parsing deno.json at {path:?}: {err}"))?;
                let val = jsonc_parser::parse_to_serde_value(string, &default())
                    .map_err(|err| ferr!("error parsing deno.json at {path:?}: {err}"))?
                    .ok_or_else(|| ferr!("error parsing deno.json at {path:?}: empty??"))?;
                Some(val)
            } else {
                None
            },
        })
    }

    /// The hash.json file stores the digests of all external accesses
    /// of a ghjkfile during serialization. The primary purpose is to
    /// do "cache invalidation" on ghjkfiles, re-serializing them if
    /// any of the digests change.
    pub async fn from_file(path: &Path) -> Result<Option<HashObj>, HashfileError> {
        let raw = match tokio::fs::read(path).await {
            Ok(val) => val,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(HashfileError::Other(ferr!("error reading hashfile: {err}"))),
        };
        serde_json::from_slice(&raw).map_err(HashfileError::Serialization)
    }

    #[tracing::instrument(skip(hcx))]
    pub async fn is_stale(&self, hcx: &HostCtx) -> Res<bool> {
        {
            if self.cli_config != hcx.gcx.config {
                trace!("stale cli config");
                return Ok(true);
            }
        }
        {
            if let Some(path) = hcx.gcx.config.deno_json.as_ref() {
                let raw = read_file(path)
                    .await
                    .map_err(|err| ferr!("error reading deno.json at {path:?}: {err}"))?
                    .ok_or_else(|| ferr!("error reading deno.json at {path:?}: file not found"))?;
                let string = std::str::from_utf8(&raw[..])
                    .map_err(|err| ferr!("utf8 error parsing deno.json at {path:?}: {err}"))?;
                let val = jsonc_parser::parse_to_serde_value(string, &default())
                    .map_err(|err| ferr!("error parsing deno.json at {path:?}: {err}"))?
                    .ok_or_else(|| ferr!("error parsing deno.json at {path:?}: empty??"))?;
                if self.deno_config != Some(val) {
                    trace!("stale deno.json");
                    return Ok(true);
                }
            }
        }
        {
            let new_digest = env_var_digests(
                &hcx.config.env_vars,
                self.env_var_hashes.keys().map(|key| &key[..]),
            );
            if self.env_var_hashes != new_digest {
                trace!("stale env var digests");
                return Ok(true);
            }
        }
        {
            for path in &self.listed_files {
                if !crate::utils::file_exists(path).await? {
                    trace!("stale listed files");
                    return Ok(true);
                }
            }
        }
        {
            if self.read_file_hashes
                != file_digests(
                    hcx,
                    self.read_file_hashes
                        .keys()
                        .map(|path| path.as_ref())
                        .collect(),
                )
                .await?
            {
                trace!("stale read files digest");
                return Ok(true);
            }
        }
        Ok(false)
    }
}

async fn read_file(path: &Path) -> Res<Option<Vec<u8>>> {
    let path = std::path::absolute(path)?;
    let path = match tokio::fs::canonicalize(path).await {
        Ok(val) => val,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(None);
        }
        Err(err) => return Err(err).wrap_err("error resolving realpath"),
    };
    Ok(Some(
        tokio::fs::read(&path)
            .await
            .map_err(|err| ferr!("error file at {path:?}: {err}"))?,
    ))
}

fn env_var_digests<'a>(
    all: &IndexMap<String, String>,
    accessed: impl Iterator<Item = &'a str>,
) -> IndexMap<String, Option<String>> {
    accessed
        .map(|key| {
            (
                key.to_owned(),
                all.get(key).map(|val| crate::utils::hash_str(val)),
            )
        })
        .collect()
}

async fn file_digests(
    hcx: &HostCtx,
    read_files: Vec<&Path>,
) -> Res<IndexMap<PathBuf, Option<String>>> {
    use futures::StreamExt;
    let mut map = futures::stream::iter(read_files.into_iter().map(|path| {
        async move {
            let path = std::path::absolute(path)?;
            let hash = file_digest_hash(hcx, &path).await?;
            let relative_path = pathdiff::diff_paths(path, &hcx.config.cwd).unwrap();
            Ok((relative_path, hash))
        }
        .boxed()
    }))
    .buffer_unordered(16)
    .collect::<Vec<_>>()
    .await
    .into_iter()
    .collect::<Res<IndexMap<_, _>>>()?;
    map.sort_unstable_keys();
    Ok(map)
}

#[tracing::instrument(skip(hcx))]
pub async fn file_digest_hash(hcx: &HostCtx, path: &Path) -> Res<Option<String>> {
    let path = match tokio::fs::canonicalize(path).await {
        Ok(val) => val,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(None);
        }
        Err(err) => return Err(err).wrap_err("error resolving realpath"),
    };
    match tokio::fs::metadata(&path).await {
        Ok(stat) => {
            const LARGE_FILE_THRESHOLD: u64 = 100 * 1024 * 1024; // 100MB

            let content_hash = if stat.file_type().is_file() || stat.file_type().is_symlink() {
                if stat.len() > LARGE_FILE_THRESHOLD {
                    warn!(
                        len = stat.len(),
                        "large file detected, skippin content hash"
                    );
                    None
                } else {
                    Some(
                        file_content_digest_hash(hcx, &path)
                            .await?
                            .await
                            .map_err(|err| ferr!(err))?,
                    )
                }
            } else {
                None
            };

            let stat = StatMeta {
                // we're not going to invalidate on access
                accessed: None,
                ..StatMeta::from(stat)
            };
            let json = json!({
                "content_hash": content_hash,
                "stat": stat
            });
            Ok(Some(crate::utils::hash_obj(&json)))
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err).wrap_err("error on file stat"),
    }
}

pub type SharedFileContentDigestFuture =
    futures::future::Shared<BoxFuture<'static, Result<CHeapStr, String>>>;

async fn file_content_digest_hash(
    hcx: &HostCtx,
    path: &Path,
) -> Res<SharedFileContentDigestFuture> {
    let path = path.to_owned();
    use dashmap::mapref::entry::*;
    match hcx.file_hash_memo.entry(path.clone()) {
        Entry::Occupied(occupied_entry) => Ok(occupied_entry.get().clone()),
        Entry::Vacant(vacant_entry) => {
            let shared = vacant_entry
                .insert(
                    async {
                        let file = tokio::fs::File::open(path)
                            .await
                            .map_err(|err| format!("error opening file: {err}"))?;
                        let hash: CHeapStr = crate::utils::hash_reader(file)
                            .await
                            .map_err(|err| format!("error hashing file reader {err}"))?
                            .into();
                        Ok(hash)
                    }
                    .boxed()
                    .shared(),
                )
                .value()
                .clone();
            Ok(shared)
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
                .map(|dur| dur.as_secs())
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
