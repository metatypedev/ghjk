#[allow(unused)]
mod interlude {
    pub use crate::utils::{default, CHeapStr, DHashMap};

    pub use std::future::Future;
    pub use std::path::{Path, PathBuf};
    pub use std::sync::Arc;

    pub use color_eyre::eyre;
    pub use eyre::{format_err as ferr, Context, Result as Res, WrapErr};
    pub use futures::{future::BoxFuture, FutureExt};
    use futures_concurrency::prelude::*;
    pub use serde::{Deserialize, Serialize};
    pub use serde_json::json;
    pub use smallvec::smallvec as svec;
    pub use smallvec::SmallVec as Svec;
    pub use tracing::{debug, error, info, trace, warn};
    pub use tracing_unwrap::*;
}
mod utils;

use crate::interlude::*;

fn main() -> Res<()> {
    // FIXME: change signal handler for children
    // FIXME: use unix_sigpipe once https://github.com/rust-lang/rust/issues/97889 lands
    unsafe {
        use nix::sys::signal::*;
        signal(Signal::SIGPIPE, SigHandler::SigDfl)?;
    }
    utils::setup_tracing()?;
    denort::init();

    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(cli())?;
    Ok(())
}

use denort::deno::deno_runtime;
use shadow_rs::shadow;
shadow!(build);

const DEFAULT_UNSTABLE_FLAGS: &[&str] = &["worker-options", "kv"];

async fn cli() -> Res<()> {
    debug!(version = build::VERSION, "ghjk CLI");

    let cwd = std::env::current_dir()?;

    let gcx = GhjkCtx {
        deno: denort::Context::from_config(
            denort::deno::args::Flags {
                unstable_config: denort::deno::args::UnstableConfig {
                    features: DEFAULT_UNSTABLE_FLAGS
                        .iter()
                        .copied()
                        .map(String::from)
                        .collect(),
                    ..default()
                },
                ..default()
            },
            Some(Arc::new(Vec::new)),
        )
        .await?,
    };

    {
        let main_module = deno_runtime::deno_core::resolve_url_or_path("play.ts", &cwd)
            .wrap_err("error resolving main module")?;
        let mut worker = gcx
            .deno
            .run_module(
                main_module.clone(),
                &deno_runtime::deno_permissions::PermissionsOptions {
                    allow_env: Some(vec![]),
                    allow_import: Some(vec![]),
                    allow_read: Some(vec![]),
                    allow_net: Some(vec![]),
                    ..default()
                },
                deno_runtime::WorkerExecutionMode::Run,
                deno_runtime::deno_io::Stdio::default(),
            )
            .await?;
        let exit_code = worker.run().await?;
        info!(%exit_code, %main_module, "module done");
        for url in worker.visted_files() {
            info!(%url, %main_module, "visited files");
        }
    }
    Ok(())
}

struct GhjkCtx {
    deno: denort::Context,
}

#[derive(Debug)]
struct Config {
    ghjkfile: PathBuf,
    share_dir: PathBuf,
    ghjk_dir: PathBuf,
}

async fn look_for_ghjkfile() {}

#[tracing::instrument]
async fn commands_from_ghjkfile(config: &Config) {
    // let lockfile_path = config.ghjk_dir.join("lock.json");
    // let hashfile_path = config.ghjk_dir.join("hash.json");
}

// #[tracing::instrument]
// async fn read_ghjkfile(config: &Config) {
//     match config.ghjkfile.extension() {
//         Some("") | Some("ts") => {
//             if let Some("") = config.ghjkfile.extension() {
//                 warn!("ghjkfile has no extension, assuming deno ghjkfile")
//             }
//             debug!("serializing deno ghjkfile")
//         }
//     }
// }

struct SerializationResult {
    config: serde_json::Value,
    accessed_env_keys: Vec<String>,
    read_file_paths: Vec<String>,
    listed_file_paths: Vec<String>,
}

async fn serialize_ghjk_ts() -> Res<SerializationResult> {
    Ok(todo!())
}

mod hashflile {
    use crate::interlude::*;

    #[derive(Debug, Serialize, Deserialize)]
    struct HashObj {
        version: String,
        /// Hash of the ghjkfile contents.
        ghjkfile_hash: String,
        /// Hashes of all env vars that were read.
        env_var_hashes: indexmap::IndexMap<String, Option<String>>,
        /// Hashes of all files that were read.
        read_file_hashes: indexmap::IndexMap<String, Option<String>>,
        /// File paths that were observed from the fs but not necessarily
        /// read.
        listed_files: Vec<String>,
    }

    /// The hash.json file stores the digests of all external accesses
    /// of a ghjkfile during serialization. The primary purpose is to
    /// do "cache invalidation" on ghjkfiles, re-serializing them if
    /// any of the digests change.
    async fn read_hash_file(path: &Path) -> Res<HashObj> {
        let raw = tokio::fs::read(path)
            .await
            .wrap_err("error reading hash.json")?;
        serde_json::from_slice(&raw).wrap_err("error parsing hash.json")
    }
}

/* mod files {
    mod deno {}
}

mod modules {
    mod envs {}
    mod ports {}
    mod tasks {}
} */
