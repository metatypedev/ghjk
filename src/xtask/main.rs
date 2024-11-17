mod interlude {
    pub use std::future::Future;
    pub use std::path::{Path, PathBuf};
    pub use std::sync::Arc;

    pub use color_eyre::eyre;
    pub use eyre::{format_err as ferr, Context, Result as Res, WrapErr};
    pub use tracing::{debug, error, info, trace, warn};
    pub use tracing_unwrap::*;
}
use crate::interlude::*;

fn main() -> Res<()> {
    use clap::Parser;
    let args = Args::parse();
    match args.command {
        Commands::Test { files } => {
            use denort::deno::deno_config;
            use denort::deno::deno_runtime;
            denort::test_sync(
                deno_config::glob::FilePatterns {
                    base: std::env::current_dir()?,
                    include: files.map(|vec| {
                        deno_config::glob::PathOrPatternSet::new(
                            vec.into_iter()
                                .map(deno_config::glob::PathOrPattern::Path)
                                .collect(),
                        )
                    }),
                    exclude: deno_config::glob::PathOrPatternSet::new(vec![]),
                },
                deno_runtime::permissions::PermissionsOptions {
                    allow_all: true,
                    ..Default::default()
                },
                Arc::new(|| None),
                None,
                None,
                vec![],
            )
        }
    }
    Ok(())
}

#[derive(Debug, clap::Parser)]
#[clap(version, about)]
struct Args {
    #[clap(subcommand)]
    command: Commands,
}

#[derive(Debug, clap::Subcommand)]
enum Commands {
    #[clap(visible_alias = "t")]
    Test {
        /// Files to test
        files: Option<Vec<PathBuf>>,
    },
}
