#![allow(clippy::let_and_return)]

pub use deno;

pub mod promises;

#[allow(unused)]
mod interlude {
    pub use std::future::Future;
    pub use std::path::{Path, PathBuf};
    pub use std::sync::Arc;

    pub use color_eyre::eyre;
    pub use deno::deno_runtime::{
        self,
        deno_core::{self, v8},
    };
    pub use eyre::{format_err as ferr, Context, Result as Res, WrapErr};
    pub use tracing::{debug, error, info, trace, warn, Instrument};
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

/// This must be called on the main thread as early as possible
/// or one will encounter stack overflows and segmentation faults
pub fn init() {
    deno::util::v8::init_v8_flags(&[], &[], deno::util::v8::get_v8_flags_from_env());
    // The stack will blow on debug builds unless we increase the size
    if cfg!(debug_assertions) {
        // We must do this early before any new threads are started
        // since std::thread might cache RUST_MIN_STACK once it's read this env
        if std::env::var("RUST_MIN_STACK").is_err() {
            std::env::set_var("RUST_MIN_STACK", "8388608");
        }
    };
}

// thread tag used for basic sanity checks
pub const WORKER_THREAD_NAME: &str = "denort-worker-thread";

/// This starts a new thread and uses it to run  all the tasks
/// that'll need to touch deno internals. Deno is single threaded.
///
/// Returned handles will use channels internally to communicate to this worker.
pub async fn worker(
    flags: deno::args::Flags,
    custom_extensions_cb: Option<Arc<deno::worker::CustomExtensionsCb>>,
) -> Res<DenoWorkerHandle> {
    let cx = WorkerContext::from_config(flags, custom_extensions_cb).await?;

    let (msg_tx, mut msg_rx) = tokio::sync::mpsc::unbounded_channel::<DenoWorkerMsg>();

    let (term_signal_tx, mut term_signal_rx) = tokio::sync::watch::channel(false);

    let join_handle = deno_core::unsync::spawn(
        async move {
            trace!("starting deno worker");
            loop {
                let msg = tokio::select! {
                  Some(msg) = msg_rx.recv() => {
                      msg
                  }
                  _ = term_signal_rx.changed() => break,
                  else => break
                };
                trace!(?msg, "deno worker msg");
                match msg {
                    DenoWorkerMsg::PrepareModule {
                        response_channel,
                        inner,
                    } => {
                        response_channel
                            .send(module_worker(&cx, term_signal_rx.clone(), inner).await)
                            .expect_or_log("channel error");
                    }
                }
            }
            // std::mem::forget(cx);
            trace!("deno worker done");
        }
        .instrument(tracing::trace_span!("deno-worker")),
    );
    // let term_signal_tx = Arc::new(term_signal_tx);
    let join_handle = Arc::new(std::sync::Mutex::new(Some(join_handle)));
    Ok(DenoWorkerHandle {
        sender: msg_tx,
        term_signal: term_signal_tx,
        join_handle,
    })
}

type TermSignal = tokio::sync::watch::Receiver<bool>;

async fn module_worker(
    cx: &WorkerContext,
    global_term_signal: TermSignal,
    msg: PrepareModuleMsg,
) -> Res<ModuleWorkerHandle> {
    let mut module_cx = cx
        .prepare_module(
            msg.main_module.clone(),
            &msg.permissions,
            msg.mode,
            msg.stdio,
            msg.custom_extensions_cb,
        )
        .await?;

    let (module_tx, mut module_rx) = tokio::sync::mpsc::channel::<ModuleWorkerReq>(1);
    deno_core::unsync::spawn(
        async move {
            trace!("starting module worker");
            while let Some(msg) = module_rx.recv().await {
                trace!(?msg, "module worker msg");
                match msg {
                    ModuleWorkerReq::Run { response_channel } => response_channel
                        .send(
                            module_cx
                                .run(global_term_signal.clone())
                                .await
                                .map_err(|err| ferr!(Box::new(err))),
                        )
                        .expect_or_log("channel error"),
                    ModuleWorkerReq::DriveTillExit {
                        term_signal,
                        response_channel,
                    } => response_channel
                        .send(
                            module_cx
                                .drive_till_exit(global_term_signal.clone(), term_signal)
                                .await
                                .map_err(|err| ferr!(Box::new(err))),
                        )
                        .expect_or_log("channel error"),
                    ModuleWorkerReq::Execute { response_channel } => response_channel
                        .send(
                            module_cx
                                .execute_main_module()
                                .await
                                .map_err(|err| ferr!(Box::new(err))),
                        )
                        .expect_or_log("channel error"),
                    ModuleWorkerReq::GetLoadedModules { response_channel } => response_channel
                        .send(module_cx.get_loaded_modules())
                        .expect_or_log("channel error"),
                }
            }
            // std::mem::forget(module_cx);
            trace!("module worker done");
        }
        .instrument(tracing::trace_span!(
            "deno-module-worker",
            main_module = %msg.main_module
        )),
    );
    Ok(ModuleWorkerHandle { sender: module_tx })
}

#[derive(educe::Educe)]
#[educe(Debug)]
struct WorkerContext {
    #[educe(Debug(ignore))]
    cli_factory: deno::factory::CliFactory,
    #[educe(Debug(ignore))]
    worker_factory: deno::worker::CliMainWorkerFactory,
    #[educe(Debug(ignore))]
    graph: Arc<graph_container::MainModuleGraphContainer>,
}

impl WorkerContext {
    async fn from_config(
        flags: deno::args::Flags,
        root_custom_extensions_cb: Option<Arc<deno::worker::CustomExtensionsCb>>,
    ) -> Res<Self> {
        deno_permissions::set_prompt_callbacks(
            Box::new(util::draw_thread::DrawThread::hide),
            Box::new(util::draw_thread::DrawThread::show),
        );

        let flags = args::Flags { ..flags };
        let flags = Arc::new(flags);
        let cli_factory = factory::CliFactory::from_flags(flags);
        let cli_factory = if let Some(custom_extensions_cb) = &root_custom_extensions_cb {
            cli_factory.with_custom_ext_cb(custom_extensions_cb.clone())
        } else {
            cli_factory
        };
        let worker_factory = cli_factory
            .create_cli_main_worker_factory()
            .await
            .map_err(|err| ferr!(Box::new(err)))?;

        let graph = cli_factory
            .main_module_graph_container()
            .await
            .map_err(|err| ferr!(Box::new(err)))?
            .clone();
        Ok(Self {
            cli_factory,
            worker_factory,
            graph,
        })
    }

    async fn prepare_module(
        &self,
        main_module: ModuleSpecifier,
        permissions: &deno_permissions::PermissionsOptions,
        mode: deno_runtime::WorkerExecutionMode,
        stdio: deno_runtime::deno_io::Stdio,
        custom_extensions_cb: Option<Arc<deno::worker::CustomExtensionsCb>>,
    ) -> Res<ModuleWorkerContext> {
        let desc_parser = self
            .cli_factory
            .permission_desc_parser()
            .map_err(|err| ferr!(Box::new(err)))?
            .clone();
        let permissions =
            deno_permissions::Permissions::from_options(desc_parser.as_ref(), permissions)?;
        let permissions = deno_permissions::PermissionsContainer::new(desc_parser, permissions);
        let mut worker = self
            .worker_factory
            .create_custom_worker(
                mode,
                main_module.clone(),
                permissions,
                custom_extensions_cb,
                stdio,
            )
            .await
            .map_err(|err| ferr!(Box::new(err)))?;
        let maybe_coverage_collector = worker
            .maybe_setup_coverage_collector()
            .await
            .map_err(|err| ferr!(Box::new(err)))?;

        // TODO: hot module support, expose shared worker contet from deno/cli/worker
        // let maybe_hmr_runner = worker
        //     .maybe_setup_hmr_runner()
        //     .await
        //     .map_err(|err| ferr!(Box::new(err)))?;

        let worker = worker.into_main_worker();

        Ok(ModuleWorkerContext {
            main_module,
            worker,
            graph: self.graph.clone(),
            maybe_coverage_collector,
            // maybe_hmr_runner,
        })
    }
}

#[derive(educe::Educe)]
#[educe(Debug)]
struct PrepareModuleMsg {
    main_module: ModuleSpecifier,
    permissions: deno_permissions::PermissionsOptions,
    #[educe(Debug(ignore))]
    mode: deno_runtime::WorkerExecutionMode,
    #[educe(Debug(ignore))]
    stdio: deno_runtime::deno_io::Stdio,
    #[educe(Debug(ignore))]
    custom_extensions_cb: Option<Arc<deno::worker::CustomExtensionsCb>>,
}

#[derive(educe::Educe)]
#[educe(Debug)]
enum DenoWorkerMsg {
    PrepareModule {
        #[educe(Debug(ignore))]
        response_channel: tokio::sync::oneshot::Sender<Res<ModuleWorkerHandle>>,
        inner: PrepareModuleMsg,
    },
}

#[derive(Clone, educe::Educe)]
#[educe(Debug)]
pub struct DenoWorkerHandle {
    sender: tokio::sync::mpsc::UnboundedSender<DenoWorkerMsg>,
    term_signal: tokio::sync::watch::Sender<bool>,
    #[educe(Debug(ignore))]
    join_handle: Arc<std::sync::Mutex<Option<JoinHandle<()>>>>,
}

impl DenoWorkerHandle {
    pub async fn terminate(self) -> Res<()> {
        self.term_signal.send(true)?;
        let join_handle = {
            let mut opt = self.join_handle.lock().expect_or_log("mutex error");
            opt.take()
        };
        let Some(join_handle) = join_handle else {
            return Ok(());
        };
        join_handle.await.wrap_err("tokio error")
    }
}

impl DenoWorkerHandle {
    pub async fn prepare_module(
        &self,
        main_module: ModuleSpecifier,
        permissions: deno_permissions::PermissionsOptions,
        mode: deno_runtime::WorkerExecutionMode,
        stdio: deno_runtime::deno_io::Stdio,
        custom_extensions_cb: Option<Arc<deno::worker::CustomExtensionsCb>>,
    ) -> Res<ModuleWorkerHandle> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.sender
            .send(DenoWorkerMsg::PrepareModule {
                response_channel: tx,
                inner: PrepareModuleMsg {
                    main_module,
                    permissions,
                    mode,
                    stdio,
                    custom_extensions_cb,
                },
            })
            .expect_or_log("channel error");
        rx.await.expect_or_log("channel error")
    }
}

#[derive(educe::Educe)]
#[educe(Debug)]
struct ModuleWorkerContext {
    main_module: deno_core::ModuleSpecifier,
    #[educe(Debug(ignore))]
    worker: deno_runtime::worker::MainWorker,
    #[educe(Debug(ignore))]
    graph: Arc<graph_container::MainModuleGraphContainer>,
    #[educe(Debug(ignore))]
    maybe_coverage_collector: Option<Box<dyn worker::CoverageCollector>>,
    // maybe_hmr_runner: Option<Box<dyn worker::HmrRunner>>,
}

impl ModuleWorkerContext {
    fn get_loaded_modules(&self) -> Vec<ModuleSpecifier> {
        use deno::graph_container::*;
        self.graph
            .graph()
            .walk(
                [&self.main_module].into_iter(),
                deno::deno_graph::WalkOptions {
                    kind: deno::deno_graph::GraphKind::CodeOnly,
                    check_js: false,
                    follow_dynamic: true,
                    prefer_fast_check_graph: false,
                },
            )
            .map(|(url, _)| url.clone())
            .collect()
    }

    async fn run(&mut self, global_term_signal: TermSignal) -> anyhow::Result<i32> {
        debug!("main_module {}", self.main_module);
        self.execute_main_module().await?;

        let (_local_signal_tx, local_signal_rx) = tokio::sync::watch::channel(false);
        self.drive_till_exit(global_term_signal, local_signal_rx)
            .await
    }

    async fn drive_till_exit(
        &mut self,
        mut global_term_signal: TermSignal,
        mut term_signal: TermSignal,
    ) -> anyhow::Result<i32> {
        self.worker.dispatch_load_event()?;
        loop {
            /* if let Some(hmr_runner) = self.maybe_hmr_runner.as_mut() {
                let watcher_communicator =
                    self.shared.maybe_file_watcher_communicator.clone().unwrap();

                let hmr_future = hmr_runner.run().boxed_local();
                let event_loop_future = self.worker.run_event_loop(false).boxed_local();

                let result;
                tokio::select! {
                  hmr_result = hmr_future => {
                    result = hmr_result;
                  },
                  event_loop_result = event_loop_future => {
                    result = event_loop_result;
                  }
                }
                if let Err(e) = result {
                    watcher_communicator.change_restart_mode(WatcherRestartMode::Automatic);
                    return Err(e);
                }
            } else {
            self.worker
                .run_event_loop(self.maybe_coverage_collector.is_none())
                .await?;
            } */

            let event_loop_future = self.worker.run_event_loop(false).boxed_local();

            tokio::select! {
              _ = global_term_signal.changed() => {
                    trace!("global term signal lit, shutting down event loop");
                  break
              },
              _ = term_signal.changed() => {
                  trace!("worker term signal lit, shutting down event loop");
                  break
              },
              event_loop_result = event_loop_future => {
                 event_loop_result?
              }
            };
            self.worker
                .run_event_loop(self.maybe_coverage_collector.is_none())
                .await?;

            let web_continue = self.worker.dispatch_beforeunload_event()?;
            if !web_continue {
                let node_continue = self.worker.dispatch_process_beforeexit_event()?;
                if !node_continue {
                    trace!("beforeunload and beforeexit success, shutting down loop");
                    break;
                }
            }
        }
        self.worker.dispatch_unload_event()?;
        self.worker.dispatch_process_exit_event()?;
        if let Some(coverage_collector) = self.maybe_coverage_collector.as_mut() {
            self.worker
                .js_runtime
                .with_event_loop_future(
                    coverage_collector.stop_collecting().boxed_local(),
                    deno_core::PollEventLoopOptions::default(),
                )
                .await?;
        }
        /* if let Some(hmr_runner) = self.maybe_hmr_runner.as_mut() {
            self.worker
                .js_runtime
                .with_event_loop_future(
                    hmr_runner.stop().boxed_local(),
                    deno_core::PollEventLoopOptions::default(),
                )
                .await?;
        } */
        Ok(self.worker.exit_code())
        //.map_err(|err| ferr!(Box::new(err)))
    }

    async fn execute_main_module(&mut self) -> anyhow::Result<()> {
        let id = self.worker.preload_main_module(&self.main_module).await?;
        self.worker.evaluate_module(id).await
    }
}

#[derive(educe::Educe)]
#[educe(Debug)]
enum ModuleWorkerReq {
    Run {
        #[educe(Debug(ignore))]
        response_channel: tokio::sync::oneshot::Sender<Res<i32>>,
    },
    DriveTillExit {
        term_signal: TermSignal,
        #[educe(Debug(ignore))]
        response_channel: tokio::sync::oneshot::Sender<Res<i32>>,
    },
    Execute {
        #[educe(Debug(ignore))]
        response_channel: tokio::sync::oneshot::Sender<Res<()>>,
    },
    GetLoadedModules {
        #[educe(Debug(ignore))]
        response_channel: tokio::sync::oneshot::Sender<Vec<ModuleSpecifier>>,
    },
}

#[derive(Clone, Debug)]
pub struct ModuleWorkerHandle {
    sender: tokio::sync::mpsc::Sender<ModuleWorkerReq>,
}

#[derive(Clone, Debug)]
pub struct FinishedWorkerHandle {
    sender: tokio::sync::mpsc::Sender<ModuleWorkerReq>,
}

impl ModuleWorkerHandle {
    /// Load and execute the main module
    /// and drive the main loop until the program
    /// exits.
    pub async fn run(self) -> Res<(i32, FinishedWorkerHandle)> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.sender
            .send(ModuleWorkerReq::Run {
                response_channel: tx,
            })
            .await
            .expect_or_log("channel error");
        Ok((
            rx.await.expect_or_log("channel error")?,
            FinishedWorkerHandle {
                sender: self.sender,
            },
        ))
    }

    /// Load and execute the main module
    /// but doesn't progress the main event
    /// loop.
    pub async fn execute(&mut self) -> Res<()> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.sender
            .send(ModuleWorkerReq::Execute {
                response_channel: tx,
            })
            .await
            .expect_or_log("channel error");
        rx.await.expect_or_log("channel error")
    }

    /// Drive the event loop until exit and return
    /// result in returned channel or the term signal
    /// is lit.
    /// Expects that [`execute`] was called first on the worker.
    pub async fn drive_till_exit(
        self,
    ) -> Res<(
        tokio::sync::oneshot::Receiver<Res<i32>>,
        tokio::sync::watch::Sender<bool>,
        FinishedWorkerHandle,
    )> {
        let (term_signal_tx, term_signal_rx) = tokio::sync::watch::channel(false);
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.sender
            .send(ModuleWorkerReq::DriveTillExit {
                term_signal: term_signal_rx,
                response_channel: tx,
            })
            .await
            .expect_or_log("channel error");
        Ok((
            rx,
            term_signal_tx,
            FinishedWorkerHandle {
                sender: self.sender,
            },
        ))
    }
}

impl FinishedWorkerHandle {
    pub async fn get_loaded_modules(&mut self) -> Vec<ModuleSpecifier> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.sender
            .send(ModuleWorkerReq::GetLoadedModules {
                response_channel: tx,
            })
            .await
            .expect_or_log("channel error");
        // FIXME: can use sync oneshot here?
        rx.await.expect_or_log("channel error")
    }
}

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
    config_file: Option<String>,
    permissions: args::PermissionFlags,
    custom_extensions: Arc<worker::CustomExtensionsCb>,
) {
    new_thread_builder()
        .spawn(|| {
            create_and_run_current_thread_with_maybe_metrics(async move {
                spawn_subcommand(async move {
                    run(main_mod, config_file, permissions, custom_extensions)
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
    config_file: Option<String>,
    permissions: args::PermissionFlags,
    custom_extensions: Arc<worker::CustomExtensionsCb>,
) -> anyhow::Result<()> {
    // NOTE: avoid using the Run subcommand
    // as it breaks our custom_extensions patch for some reason
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
        config_flag: if let Some(config_file) = config_file {
            args::ConfigFlag::Path(config_file)
        } else {
            Default::default()
        },
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

    let test_flags = args::TestFlags {
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
    };
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
        // deno & swc need 8 MiB with dev profile (release is ok)
        // https://github.com/swc-project/swc/blob/main/CONTRIBUTING.md
        builder.stack_size(8 * 1024 * 1024)
    } else {
        // leave default: https://doc.rust-lang.org/std/thread/#stack-size
        builder
    };
    builder
}
