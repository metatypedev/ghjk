#[allow(unused)]
mod interlude {
    pub use crate::utils::{default, CHeapStr, DHashMap};

    pub use std::future::Future;
    pub use std::path::{Path, PathBuf};
    pub use std::sync::Arc;

    pub use color_eyre::eyre;
    pub use eyre::{format_err as ferr, Context, Result as Res, WrapErr};
    pub use futures_lite::{future::Boxed as BoxedFut, FutureExt};
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
    utils::setup_tracing()?;

    denort::run_sync(
        "main.ts".parse()?,
        None,
        denort::deno::args::PermissionFlags {
            allow_all: true,
            ..default()
        },
        Arc::new(std::vec::Vec::new),
    );

    Ok(())
}
