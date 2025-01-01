use crate::interlude::*;
use deno::{
    deno_runtime::{
        deno_core::{futures::FutureExt, ModuleSpecifier},
        deno_permissions,
    },
    *,
};

// thread tag used for basic sanity checks
pub const WORKER_THREAD_NAME: &str = "denort-worker-thread";

/// This starts a new task to run all the work
/// that'll need to touch deno internals.
/// Deno is single threaded and this expects to run on single threaded runtimes.
///
/// The returned handle will use channels internally to communicate to this worker.
pub async fn worker(
    flags: deno::args::Flags,
    custom_extensions_cb: Option<Arc<deno::worker::CustomExtensionsCb>>,
) -> Res<DenoWorkerHandle> {
    let cx = WorkerContext::from_config(flags, custom_extensions_cb).await?;

    let (msg_tx, mut msg_rx) = tokio::sync::mpsc::channel::<DenoWorkerMsg>(32);

    let (term_signal_tx, term_signal_rx) = tokio::sync::watch::channel(false);

    let mut term_signal_rx2 = term_signal_rx.clone();
    let join_handle = crate::unsync::spawn(
        "deno-worker",
        async move {
            let mut task_set = crate::unsync::JoinSet::default();
            trace!("starting deno worker");
            loop {
                let msg = tokio::select! {
                  Some(msg) = msg_rx.recv() => {
                      msg
                  }
                  _ = term_signal_rx2.changed() => break,
                  else => break
                };
                trace!(?msg, "deno worker msg");
                match msg {
                    DenoWorkerMsg::PrepareModule {
                        response_channel,
                        inner,
                    } => {
                        response_channel
                            .send(
                                module_worker(&cx, term_signal_rx2.clone(), inner, &mut task_set)
                                    .await,
                            )
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
        term_signal_tx,
        term_signal_rx,
        join_handle,
    })
}

type TermSignal = tokio::sync::watch::Receiver<bool>;

async fn module_worker(
    cx: &WorkerContext,
    global_term_signal: TermSignal,
    msg: PrepareModuleMsg,
    task_set: &mut crate::unsync::JoinSet<()>,
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
    task_set.spawn_named(
        &format!("deno-module-worker-{}", msg.main_module),
        async move {
            trace!("starting module worker");
            while let Some(msg) = module_rx.recv().await {
                trace!(?msg, "module worker msg");
                match msg {
                    ModuleWorkerReq::Run { response_channel } => response_channel
                        .send(module_cx.run(global_term_signal.clone()).await)
                        .expect_or_log("channel error"),
                    ModuleWorkerReq::DriveTillExit {
                        term_signal,
                        response_channel,
                    } => response_channel
                        .send(
                            module_cx
                                .drive_till_exit(global_term_signal.clone(), term_signal)
                                .await
                                .map_err(crate::anyhow_to_eyre!()),
                        )
                        .expect_or_log("channel error"),
                    ModuleWorkerReq::Execute { response_channel } => response_channel
                        .send(
                            module_cx
                                .execute_main_module()
                                .await
                                .map_err(crate::anyhow_to_eyre!()),
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
            .map_err(crate::anyhow_to_eyre!())?
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
            .map_err(crate::anyhow_to_eyre!())?
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
            .map_err(crate::anyhow_to_eyre!())?;
        let maybe_coverage_collector = worker
            .maybe_setup_coverage_collector()
            .await
            .map_err(crate::anyhow_to_eyre!())?;

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
    sender: tokio::sync::mpsc::Sender<DenoWorkerMsg>,
    term_signal_tx: tokio::sync::watch::Sender<bool>,
    #[educe(Debug(ignore))]
    join_handle: Arc<std::sync::Mutex<Option<crate::unsync::JoinHandle<()>>>>,
    term_signal_rx: tokio::sync::watch::Receiver<bool>,
}

impl DenoWorkerHandle {
    pub fn term_signal_watcher(&self) -> tokio::sync::watch::Receiver<bool> {
        self.term_signal_rx.clone()
    }

    pub async fn terminate(self) -> Res<()> {
        let join_handle = {
            let mut opt = self.join_handle.lock().expect_or_log("mutex error");
            opt.take()
        };
        let Some(join_handle) = join_handle else {
            return Ok(());
        };
        self.term_signal_tx.send(true)?;
        let abort_handle = join_handle.abort_handle();
        match tokio::time::timeout(std::time::Duration::from_millis(100), join_handle).await {
            Ok(val) => val.wrap_err("tokio error"),
            Err(_) => {
                trace!("timeout waiting for deno worker termination, aborting");
                abort_handle.abort();
                Ok(())
            }
        }
        //join_handle.await.wrap_err("tokio error")
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
            .await
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
            .modules()
            .map(|module| match module {
                deno_graph::Module::Js(js_module) => js_module.specifier.clone(),
                deno_graph::Module::Json(json_module) => json_module.specifier.clone(),
                deno_graph::Module::Wasm(wasm_module) => wasm_module.specifier.clone(),
                deno_graph::Module::Npm(npm_module) => npm_module.specifier.clone(),
                deno_graph::Module::Node(built_in_node_module) => {
                    built_in_node_module.specifier.clone()
                }
                deno_graph::Module::External(external_module) => external_module.specifier.clone(),
            })
            .collect()
    }

    async fn run(&mut self, global_term_signal: TermSignal) -> Res<i32> {
        debug!("main_module {}", self.main_module);
        self.execute_main_module()
            .await
            .map_err(crate::anyhow_to_eyre!())?;

        let (_term_signal_tx, term_signal_rx) = tokio::sync::watch::channel(false);
        let exit_code = self
            .drive_till_exit(global_term_signal, term_signal_rx)
            .await
            .map_err(crate::anyhow_to_eyre!())?;

        Ok(exit_code)
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

            let event_loop_future = self
                .worker
                .run_event_loop(self.maybe_coverage_collector.is_none())
                .boxed_local();

            trace!("running event loop");
            tokio::select! {
              _ = global_term_signal.wait_for(|sig| *sig) => {
                  trace!("global term signal lit, shutting down event loop");
                  break
              },
              _ = term_signal.wait_for(|sig| *sig) => {
                  trace!("worker term signal lit, shutting down event loop");
                  break
              },
              event_loop_result = event_loop_future => {
                anyhow::Context::context(event_loop_result, "event loop error")?;
              }
            }

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

#[derive(Debug)]
pub struct ActiveWorkerHandle {
    pub exit_code_rx: tokio::sync::oneshot::Receiver<Res<i32>>,
    pub term_signal_tx: tokio::sync::watch::Sender<bool>,
    pub finished: FinishedWorkerHandle,
}

impl ModuleWorkerHandle {
    /// Load and execute the main module
    /// and drive the main loop until the program
    /// exits.
    pub async fn run(self) -> Res<(i32, FinishedWorkerHandle)> {
        let (result_tx, result_rx) = tokio::sync::oneshot::channel();
        self.sender
            .send(ModuleWorkerReq::Run {
                response_channel: result_tx,
            })
            .await
            .expect_or_log("channel error");
        Ok((
            result_rx.await.expect_or_log("channel error")?,
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
    pub async fn drive_till_exit(self) -> Res<ActiveWorkerHandle> {
        let (term_signal_tx, term_signal_rx) = tokio::sync::watch::channel(false);
        let (exit_code_tx, exit_code_rx) = tokio::sync::oneshot::channel();
        self.sender
            .send(ModuleWorkerReq::DriveTillExit {
                term_signal: term_signal_rx,
                response_channel: exit_code_tx,
            })
            .await
            .expect_or_log("channel error");
        Ok(ActiveWorkerHandle {
            exit_code_rx,
            term_signal_tx,
            finished: FinishedWorkerHandle {
                sender: self.sender,
            },
        })
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
