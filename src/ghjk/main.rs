#[allow(unused)]
mod interlude {
    pub use crate::utils::{default, CHeapStr, DHashMap, JsonExt};
    pub use crate::GhjkCtx;

    pub use std::collections::HashMap;
    pub use std::path::{Path, PathBuf};
    pub use std::sync::Arc;

    pub use color_eyre::{eyre, Section, SectionExt};
    pub use denort::deno::{
        self,
        deno_runtime::{
            self,
            deno_core::{self, serde_v8, url, v8},
        },
    };
    pub use eyre::{format_err as ferr, Context, Result as Res, WrapErr};
    pub use futures::{future::BoxFuture, FutureExt};
    pub use indexmap::IndexMap;
    pub use itertools::Itertools;
    pub use serde::{Deserialize, Serialize};
    pub use serde_json::json;
    pub use smallvec::smallvec as svec;
    pub use smallvec::SmallVec as Svec;
    pub use tracing::{debug, error, info, trace, warn, Instrument};
    pub use tracing_unwrap::*;
}

mod host;

mod cli;
mod config;
mod ext;
mod log;
mod systems;
mod utils;

use crate::interlude::*;

fn main() -> Res<std::process::ExitCode> {
    let None = cli::deno_quick_cli() else {
        unreachable!();
    };

    // FIXME: change signal handler for children
    // FIXME: use unix_sigpipe once https://github.com/rust-lang/rust/issues/97889 lands
    unsafe {
        use nix::sys::signal::*;
        signal(Signal::SIGPIPE, SigHandler::SigDfl)?;
    }
    std::env::set_var("DENO_NO_UPDATE_CHECK", "1");

    log::init();
    denort::init();

    debug!(version = shadow::PKG_VERSION, "ghjk CLI");

    match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(cli::cli())
    {
        Ok(code) => Ok(code),
        Err(err) => {
            let err_msg = format!("{err:?}");
            let err_msg = err_msg.split('\n').filter(
                |&line|
                line != "Backtrace omitted. Run with RUST_BACKTRACE=1 environment variable to display it." 
                && line != "Run with RUST_BACKTRACE=full to include source snippets."
            ).join("\n");
            println!("{err_msg}");
            Ok(std::process::ExitCode::FAILURE)
        }
    }
}

use shadow_rs::shadow;
shadow!(shadow);

#[derive(Debug)]
pub struct GhjkCtx {
    deno: denort::worker::DenoWorkerHandle,
    config: config::Config,
}
