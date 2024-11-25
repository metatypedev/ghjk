use crate::interlude::*;

use super::HostCtx;

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

pub fn env_var_digests<'a>(
    all: &IndexMap<String, String>,
    accessed: impl Iterator<Item = &'a str>,
) -> IndexMap<String, Option<String>> {
    accessed
        .map(|key| {
            (
                key.to_owned(),
                match all.get(key) {
                    Some(val) => Some(crate::utils::hash_str(val)),
                    None => None,
                },
            )
        })
        .collect()
}

pub async fn file_digests(
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

pub async fn file_digest_hash(hcx: &HostCtx, path: &Path) -> Res<Option<String>> {
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

pub async fn file_content_digest_hash(hcx: &HostCtx, path: &Path) -> Res<CHeapStr> {
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
