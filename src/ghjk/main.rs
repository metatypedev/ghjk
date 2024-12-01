#[allow(unused)]
mod interlude {
    pub use crate::utils::{default, CHeapStr, DHashMap};

    pub use std::collections::HashMap;
    pub use std::future::Future;
    pub use std::path::{Path, PathBuf};
    pub use std::sync::Arc;

    pub use crate::GhjkCtx;

    pub use color_eyre::eyre;
    pub use denort::deno::{
        self,
        deno_runtime::{
            self,
            deno_core::{self, url},
        },
    };
    pub use eyre::{format_err as ferr, Context, Result as Res, WrapErr};
    pub use futures::{future::BoxFuture, FutureExt};
    pub use futures_concurrency::{future::Join, prelude::*};
    pub use indexmap::IndexMap;
    pub use serde::{Deserialize, Serialize};
    pub use serde_json::json;
    pub use smallvec::smallvec as svec;
    pub use smallvec::SmallVec as Svec;
    pub use tracing::{debug, error, info, trace, warn, Instrument};
    pub use tracing_unwrap::*;
}

mod host;

mod cli {}
mod ext;
mod log;
mod systems;
mod utils;

use crate::interlude::*;

fn main() -> Res<()> {
    // FIXME: change signal handler for children
    // FIXME: use unix_sigpipe once https://github.com/rust-lang/rust/issues/97889 lands
    unsafe {
        use nix::sys::signal::*;
        signal(Signal::SIGPIPE, SigHandler::SigDfl)?;
    }
    log::init();
    denort::init();

    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(cli())?;
    Ok(())
}

use shadow_rs::shadow;
shadow!(build);

const DENO_UNSTABLE_FLAGS: &[&str] = &["worker-options", "kv"];

async fn cli() -> Res<()> {
    debug!(version = build::PKG_VERSION, "ghjk CLI");

    let cwd = std::env::current_dir()?;

    let config = {
        let ghjk_dir_path = match std::env::var("GHJK_DIR") {
            Ok(path) => Some(PathBuf::from(path)),
            Err(std::env::VarError::NotUnicode(os_str)) => Some(PathBuf::from(os_str)),
            Err(std::env::VarError::NotPresent) => {
                utils::find_entry_recursive(&cwd, ".ghjk").await?
            }
        };

        let ghjk_dir_path = if let Some(path) = ghjk_dir_path {
            Some(tokio::fs::canonicalize(path).await?)
        } else {
            None
        };

        let ghjkfile_path = match &ghjk_dir_path {
            Some(ghjkfile_path) => {
                utils::find_entry_recursive(
                    ghjkfile_path
                        .parent()
                        .expect_or_log("invalid GHJK_DIR path"),
                    "ghjk.ts",
                )
                .await?
            }
            None => utils::find_entry_recursive(&cwd, "ghjk.ts").await?,
        };

        let ghjkfile_path = if let Some(path) = ghjkfile_path {
            Some(tokio::fs::canonicalize(path).await?)
        } else {
            None
        };

        if ghjk_dir_path.is_none() && ghjkfile_path.is_none() {
            warn!(
                "ghjk could not find any ghjkfiles or ghjkdirs, try creating a `ghjk.ts` script.",
            );
        }

        let share_dir_path = match std::env::var("GHJK_SHARE_DIR") {
            Ok(path) => PathBuf::from(path),
            Err(std::env::VarError::NotUnicode(os_str)) => PathBuf::from(os_str),
            Err(std::env::VarError::NotPresent) => directories::BaseDirs::new()
                .expect_or_log("unable to resolve home dir")
                .data_local_dir()
                .join("ghjk"),
        };
        Config {
            ghjkfile_path,
            ghjk_dir_path,
            share_dir_path,
        }
    };

    let deno_cx = denort::worker(
        denort::deno::args::Flags {
            unstable_config: denort::deno::args::UnstableConfig {
                features: DENO_UNSTABLE_FLAGS
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
    .await?;

    if let Some(ghjk_dir_path) = config.ghjk_dir_path {
        let gcx = GhjkCtx {
            ghjk_dir_path,
            ghjkfile_path: config.ghjkfile_path,
            share_dir_path: config.share_dir_path,
            repo_root: url::Url::from_file_path(&cwd)
                .expect_or_log("cwd error")
                // repo root url must end in slash due to
                // how Url::join works
                .join(&format!("{}/", cwd.file_name().unwrap().to_string_lossy()))
                .wrap_err("repo url error")?,
            deno: deno_cx.clone(),
        };
        let gcx = Arc::new(gcx);

        let systems_deno = systems::deno::systems_from_deno(
            &gcx,
            &gcx.repo_root
                .join("src/deno_systems/mod.ts")
                .wrap_err("repo url error")?,
        )
        .await?;

        let hcx = host::HostCtx::new(
            gcx,
            host::Config {
                re_resolve: false,
                locked: false,
                re_serialize: false,
                env_vars: std::env::vars().collect(),
                cwd,
            },
            systems_deno,
        );

        let hcx = Arc::new(hcx);

        if let Some(mut systems) = host::systems_from_ghjkfile(hcx).await? {
            let conf_json = serde_json::to_string_pretty(&systems.config)?;
            info!(%conf_json);
            systems.write_lockfile().await?;
        } else {
            warn!("no ghjkfile found");
        }
    }

    // tokio::task::spawn_blocking(|| deno_cx.terminate());

    Ok(())
}

#[derive(Debug)]
pub struct GhjkCtx {
    deno: denort::DenoWorkerHandle,
    repo_root: url::Url,
    ghjkfile_path: Option<PathBuf>,
    ghjk_dir_path: PathBuf,
    share_dir_path: PathBuf,
}

#[derive(Debug)]
struct Config {
    ghjkfile_path: Option<PathBuf>,
    ghjk_dir_path: Option<PathBuf>,
    share_dir_path: PathBuf,
}

/* mod files {
    mod deno {}
}

mod modules {
    mod envs {}
    mod ports {}
    mod tasks {}
} */
