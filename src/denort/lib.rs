#![allow(dead_code, clippy::let_and_return)]

pub use deno;

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
use crate::interlude::*;
use deno::{
    deno_runtime::{
        deno_core::{futures::FutureExt, unsync::JoinHandle, ModuleSpecifier},
        deno_permissions,
        tokio_util::create_and_run_current_thread_with_maybe_metrics,
    },
    *,
};

#[rustfmt::skip]
use deno_runtime::deno_core as deno_core; // necessary for re-exported macros to work

const DEFAULT_UNSTABLE_FLAGS: &[&str] = &["worker-options", "kv" /* "net", "http" */];
const CACHE_BLOCKLIST: &[&str] = &[
    "npm:/@typegraph/sdk",
    "npm:/@typegraph/sdk/",
    "npm:@typegraph/sdk",
    "npm:@typegraph/sdk/",
];

/// Ensure that the subcommand runs in a task, rather than being directly executed. Since some of these
/// futures are very large, this prevents the stack from getting blown out from passing them by value up
/// the callchain (especially in debug mode when Rust doesn't have a chance to elide copies!).
#[inline(always)]
fn spawn_subcommand<F: Future<Output = ()> + 'static>(f: F) -> JoinHandle<()> {
    // the boxed_local() is important in order to get windows to not blow the stack in debug
    deno_core::unsync::spawn(f.boxed_local())
}

pub fn run_sync(
    main_mod: ModuleSpecifier,
    import_map_url: Option<String>,
    permissions: args::PermissionFlags,
    custom_extensions: Arc<worker::CustomExtensionsCb>,
) {
    new_thread_builder()
        .spawn(|| {
            create_and_run_current_thread_with_maybe_metrics(async move {
                spawn_subcommand(async move {
                    run(main_mod, import_map_url, permissions, custom_extensions)
                        .await
                        .unwrap()
                })
                .await
                .unwrap()
            })
        })
        .unwrap()
        .join()
        .unwrap();
}

pub async fn run(
    main_module: ModuleSpecifier,
    import_map_url: Option<String>,
    permissions: args::PermissionFlags,
    custom_extensions: Arc<worker::CustomExtensionsCb>,
) -> anyhow::Result<()> {
    deno::util::v8::init_v8_flags(&[], &[], deno::util::v8::get_v8_flags_from_env());

    deno_permissions::set_prompt_callbacks(
        Box::new(util::draw_thread::DrawThread::hide),
        Box::new(util::draw_thread::DrawThread::show),
    );

    // NOTE: avoid using the Run subcommand
    // as it breaks our custom_extensions patch for some reason
    let flags = args::Flags {
        permissions,
        import_map_path: import_map_url,
        unstable_config: args::UnstableConfig {
            features: DEFAULT_UNSTABLE_FLAGS
                .iter()
                .copied()
                .map(String::from)
                .collect(),
            ..Default::default()
        },
        #[cfg(debug_assertions)]
        cache_blocklist: CACHE_BLOCKLIST
            .iter()
            .cloned()
            .map(str::to_string)
            .collect(),
        ..Default::default()
    };

    let flags = Arc::new(flags);

    let cli_factory = factory::CliFactory::from_flags(flags).with_custom_ext_cb(custom_extensions);

    let worker_factory = cli_factory.create_cli_main_worker_factory().await?;

    let mut worker = worker_factory
        .create_main_worker(deno_runtime::WorkerExecutionMode::Run, main_module)
        .await?;
    tracing::info!("running worker");
    let exit_code = worker.run().await?;
    println!("exit_code: {exit_code}");
    Ok(())
}

pub fn test_sync(
    files: deno_config::glob::FilePatterns,
    config_file: PathBuf,
    permissions: args::PermissionFlags,
    coverage_dir: Option<String>,
    filter: Option<String>,
    custom_extensions: Arc<worker::CustomExtensionsCb>,
    argv: Vec<String>,
) {
    new_thread_builder()
        .spawn(|| {
            create_and_run_current_thread_with_maybe_metrics(async move {
                spawn_subcommand(async move {
                    test(
                        files,
                        config_file,
                        permissions,
                        coverage_dir,
                        filter,
                        custom_extensions,
                        argv,
                    )
                    .await
                    .unwrap()
                })
                .await
                .unwrap()
            })
        })
        .unwrap()
        .join()
        .unwrap();
}

pub async fn test(
    files: deno_config::glob::FilePatterns,
    config_file: PathBuf,
    permissions: args::PermissionFlags,
    coverage_dir: Option<String>,
    filter: Option<String>,
    custom_extensions: Arc<worker::CustomExtensionsCb>,
    argv: Vec<String>,
) -> anyhow::Result<()> {
    use deno::tools::test::*;

    deno::util::v8::init_v8_flags(&[], &[], deno::util::v8::get_v8_flags_from_env());

    deno_permissions::set_prompt_callbacks(
        Box::new(util::draw_thread::DrawThread::hide),
        Box::new(util::draw_thread::DrawThread::show),
    );
    let pattern_to_str = |pattern| match pattern {
        deno_config::glob::PathOrPattern::Path(path) => path.to_string_lossy().to_string(),
        deno_config::glob::PathOrPattern::Pattern(pattern) => pattern.as_str().to_string(),
        deno_config::glob::PathOrPattern::RemoteUrl(url) => url.as_str().to_owned(),
        deno_config::glob::PathOrPattern::NegatedPath(path) => path.to_string_lossy().to_string(),
    };

    let test_flags = dbg!(args::TestFlags {
        files: args::FileFlags {
            include: files
                .include
                .clone()
                .map(|set| set.into_path_or_patterns().into_iter())
                .unwrap_or_default()
                .map(pattern_to_str)
                .collect(),
            ignore: files
                .exclude
                .clone()
                .into_path_or_patterns()
                .into_iter()
                .map(pattern_to_str)
                .collect(),
        },
        doc: true,
        trace_leaks: true,
        coverage_dir,
        filter,
        concurrent_jobs: std::thread::available_parallelism().ok(),
        ..Default::default()
    });
    let flags = args::Flags {
        permissions,
        unstable_config: args::UnstableConfig {
            features: DEFAULT_UNSTABLE_FLAGS
                .iter()
                .copied()
                .map(String::from)
                .collect(),
            ..Default::default()
        },
        type_check_mode: args::TypeCheckMode::Local,
        config_flag: args::ConfigFlag::Path(config_file.to_string_lossy().into()),
        argv,
        subcommand: args::DenoSubcommand::Test(test_flags.clone()),
        cache_blocklist: CACHE_BLOCKLIST
            .iter()
            .cloned()
            .map(str::to_string)
            .collect(),
        ..Default::default()
    };

    let flags = Arc::new(flags);

    let cli_factory = factory::CliFactory::from_flags(flags).with_custom_ext_cb(custom_extensions);

    let options = cli_factory.cli_options()?.clone();

    let test_options = args::WorkspaceTestOptions {
        // files,
        ..options.resolve_workspace_test_options(&test_flags)
    };
    let members_with_test_opts = options.resolve_test_options_for_members(&test_flags)?;
    let file_fetcher = cli_factory.file_fetcher()?;

    let specifiers_with_mode = fetch_specifiers_with_test_mode(
        options.as_ref(),
        file_fetcher,
        members_with_test_opts
            .into_iter()
            .map(|(_, opts)| opts.files),
        &test_options.doc,
    )
    .await?;

    if !test_options.permit_no_files && specifiers_with_mode.is_empty() {
        return Err(deno_core::error::generic_error("No test modules found"));
    }
    let doc_tests = get_doc_tests(&specifiers_with_mode, file_fetcher).await?;
    let specifiers_for_typecheck_and_test = get_target_specifiers(specifiers_with_mode, &doc_tests);
    for doc_test in doc_tests {
        file_fetcher.insert_memory_files(doc_test);
    }

    let main_graph_container = cli_factory.main_module_graph_container().await?;

    // type check
    main_graph_container
        .check_specifiers(
            &specifiers_for_typecheck_and_test,
            options.ext_flag().as_ref(),
        )
        .await?;

    if test_options.no_run {
        return Ok(());
    }

    let worker_factory = cli_factory.create_cli_main_worker_factory().await?;
    let worker_factory = Arc::new(worker_factory);

    // Various test files should not share the same permissions in terms of
    // `PermissionsContainer` - otherwise granting/revoking permissions in one
    // file would have impact on other files, which is undesirable.
    let desc_parser = &cli_factory.permission_desc_parser()?;
    let permissions = deno_permissions::Permissions::from_options(
        desc_parser.as_ref(),
        &options.permissions_options(),
    )?;

    // run tests
    test_specifiers(
        worker_factory,
        &permissions,
        desc_parser,
        specifiers_for_typecheck_and_test,
        TestSpecifiersOptions {
            cwd: deno_core::url::Url::from_directory_path(options.initial_cwd()).map_err(|_| {
                anyhow::anyhow!(
                    "Unable to construct URL from the path of cwd: {}",
                    options.initial_cwd().to_string_lossy(),
                )
            })?,
            concurrent_jobs: test_options.concurrent_jobs,
            fail_fast: test_options.fail_fast,
            log_level: options.log_level(),
            filter: test_options.filter.is_some(),
            reporter: test_options.reporter,
            junit_path: test_options.junit_path,
            specifier: TestSpecifierOptions {
                filter: TestFilter::from_flag(&test_options.filter),
                shuffle: test_options.shuffle,
                trace_leaks: test_options.trace_leaks,
            },
            hide_stacktraces: true,
        },
    )
    .await?;

    Ok(())
}

pub fn new_thread_builder() -> std::thread::Builder {
    let builder = std::thread::Builder::new();
    let builder = if cfg!(debug_assertions) {
        // this is only relevant for WebWorkers
        // FIXME: find a better location for this as tihs won't work
        // if a second thread has already launched by this point
        if std::env::var("RUST_MIN_STACK").is_err() {
            unsafe {
                std::env::set_var("RUST_MIN_STACK", "8388608");
            }
        }
        // deno & swc need 8 MiB with dev profile (release is ok)
        // https://github.com/swc-project/swc/blob/main/CONTRIBUTING.md
        builder.stack_size(8 * 1024 * 1024)
    } else {
        // leave default: https://doc.rust-lang.org/std/thread/#stack-size
        builder
    };
    builder
}
