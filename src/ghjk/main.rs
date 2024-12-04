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

mod cli;
mod ext;
mod log;
mod systems;
mod utils;

use crate::interlude::*;

fn main() -> Res<std::process::ExitCode> {
    // FIXME: change signal handler for children
    // FIXME: use unix_sigpipe once https://github.com/rust-lang/rust/issues/97889 lands
    unsafe {
        use nix::sys::signal::*;
        signal(Signal::SIGPIPE, SigHandler::SigDfl)?;
    }
    log::init();
    denort::init();

    debug!(version = shadow::PKG_VERSION, "ghjk CLI");

    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(cli::cli())
}

use shadow_rs::shadow;
shadow!(shadow);

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
    ghjkdir_path: Option<PathBuf>,
    share_dir_path: PathBuf,
}
