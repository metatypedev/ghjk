#[allow(unused)]
mod interlude {
    pub use std::future::Future;
    pub use std::path::{Path, PathBuf};
    pub use std::sync::Arc;

    pub use color_eyre::eyre;
    pub use eyre::{format_err as ferr, Context, Result as Res, WrapErr};
    pub use tracing::{debug, error, info, trace, warn};
    pub use tracing_unwrap::*;
}
use clap::builder::styling::AnsiColor;

use crate::interlude::*;

mod utils;

fn main() -> Res<()> {
    utils::setup_tracing()?;
    let cwd = std::env::current_dir()?;

    use clap::Parser;
    let args = Args::parse();
    match args.command {
        Commands::Test { files, filter } => {
            use denort::deno::deno_config;
            denort::test_sync(
                deno_config::glob::FilePatterns {
                    include: if let Some(vec) = files {
                        Some(deno_config::glob::PathOrPatternSet::new(
                            vec.into_iter()
                                .map(|path| {
                                    deno_config::glob::PathOrPattern::from_relative(&cwd, &path)
                                })
                                .collect::<Result<Vec<_>, _>>()?,
                        ))
                    } else {
                        None
                    },
                    exclude: deno_config::glob::PathOrPatternSet::new(vec![]),
                    base: cwd,
                },
                "deno.jsonc".into(),
                denort::deno::args::PermissionFlags {
                    allow_all: true,
                    ..Default::default()
                },
                None,
                filter,
                Arc::new(std::vec::Vec::new),
                vec![],
            )
        } /* Commands::Run { argv } => denort::run_sync(
              denort::deno::deno_runtime::deno_core::resolve_url_or_path("ghjk.ts", &cwd).unwrap(),
              Some("deno.jsonc".into()),
              denort::deno::args::PermissionFlags {
                  allow_all: true,
                  ..Default::default()
              },
              Arc::new(std::vec::Vec::new),
          ), */
    }

    Ok(())
}

const CLAP_STYLE: clap::builder::Styles = clap::builder::Styles::styled()
    .header(AnsiColor::Yellow.on_default())
    .usage(AnsiColor::Green.on_default())
    .literal(AnsiColor::Green.on_default())
    .placeholder(AnsiColor::Green.on_default());

#[derive(Debug, clap::Parser)]
#[clap(
    version,
    about,
    styles = CLAP_STYLE
)]
struct Args {
    #[clap(subcommand)]
    command: Commands,
}

#[derive(Debug, clap::Subcommand)]
enum Commands {
    /* #[clap(visible_alias = "r")]
    Run {
        /// Script arg
        argv: Vec<String>,
    }, */
    #[clap(visible_alias = "t")]
    Test {
        /// Files to test
        files: Option<Vec<String>>,
        /// Tests to include
        #[arg(long)]
        filter: Option<String>,
    },
}
