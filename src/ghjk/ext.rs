use crate::interlude::*;

use std::{cell::RefCell, rc::Rc};

use deno_core::v8;
use deno_core::OpState;
use tokio::sync::mpsc;
#[rustfmt::skip]
use deno_core as deno_core; // necessary for re-exported macros to work

mod callbacks;
pub use callbacks::CallbacksHandle;

/// This extension assumes that deno was launched on top of a tokio::LocalSet
pub fn extensions(config: ExtConfig) -> Arc<denort::deno::worker::CustomExtensionsCb> {
    // let atom = std::sync::atomic::AtomicBool::new(false);
    Arc::new(move || {
        // if atom.load(std::sync::atomic::Ordering::SeqCst) {
        //     return vec![];
        // }
        // atom.store(true, std::sync::atomic::Ordering::SeqCst);
        vec![ghjk_deno_ext::init_ops_and_esm(config.clone())]
    })
}
// This is used to populate the deno_core::OpState with dependencies
// used by the different ops
#[derive(Clone, Default)]
pub struct ExtConfig {
    pub blackboard: Arc<DHashMap<CHeapStr, serde_json::Value>>,
    callbacks_rx: Arc<std::sync::Mutex<callbacks::CallbackLine>>,
    exception_tx: Option<mpsc::UnboundedSender<eyre::Report>>,
    pub hostcalls: Hostcalls,
}

impl ExtConfig {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn callbacks_handle(
        &mut self,
        dworker: &denort::worker::DenoWorkerHandle,
    ) -> callbacks::CallbacksHandle {
        let (line, handle) = callbacks::CallbackLine::new(dworker);
        self.callbacks_rx = Arc::new(std::sync::Mutex::new(line));

        handle
    }

    pub fn exceptions_rx(&mut self) -> mpsc::UnboundedReceiver<eyre::Report> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.exception_tx = Some(tx);
        rx
    }

    fn inject(self, state: &mut deno_core::OpState) {
        let callbacks = callbacks::worker(&self);
        let ctx = ExtContext {
            config: self,
            callbacks,
        };
        state.put(ctx);
    }
}

deno_core::extension!(
    ghjk_deno_ext,
    ops = [
        op_blackboard_get,
        op_blackboard_set,
        callbacks::op_callbacks_set,
        op_hostcall,
        op_dispatch_exception2
    ],
    options = { config: ExtConfig },
    state = |state, opt| {
        opt.config.inject(state);
    },
    customizer = customizer,
    docs = "Kitchen sink extension for all ghjk needs.",
);

fn customizer(ext: &mut deno_core::Extension) {
    ext.esm_files
        .to_mut()
        .push(deno_core::ExtensionFileSource::new(
            "ext:ghjk_deno_ext/00_runtime.js",
            deno_core::ascii_str_include!("js/00_runtime.js"),
        ));
    ext.esm_entry_point = Some("ext:ghjk_deno_ext/00_runtime.js");
}

#[derive(Clone)]
struct ExtContext {
    callbacks: Option<callbacks::Callbacks>,
    config: ExtConfig,
}

#[deno_core::op2]
#[serde]
pub fn op_blackboard_get(
    #[state] ctx: &ExtContext,
    #[string] key: &str,
) -> Option<serde_json::Value> {
    ctx.config.blackboard.get(key).map(|val| val.clone())
}

#[deno_core::op2]
#[serde]
pub fn op_blackboard_set(
    #[state] ctx: &ExtContext,
    #[string] key: String,
    #[serde] val: serde_json::Value,
) -> Option<serde_json::Value> {
    ctx.config.blackboard.insert(key.into(), val)
}

#[derive(Clone, Default)]
pub struct Hostcalls {
    pub funcs: Arc<DHashMap<CHeapStr, HostcallFn>>,
}

pub type HostcallFn = Box<
    dyn Fn(serde_json::Value) -> BoxFuture<'static, Res<serde_json::Value>> + 'static + Send + Sync,
>;

#[deno_core::op2(async)]
#[serde]
pub async fn op_hostcall(
    state: Rc<RefCell<OpState>>,
    #[string] name: String,
    #[serde] args: serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    let ctx = {
        let state = state.borrow();
        let ctx = state.borrow::<ExtContext>();
        ctx.clone()
    };
    let Some(func) = ctx.config.hostcalls.funcs.get(&name[..]) else {
        anyhow::bail!("no hostcall found under {name}");
    };
    func(args).await.map_err(|err| anyhow::anyhow!(err))
}

#[deno_core::op2(fast)]
pub fn op_dispatch_exception2(
    scope: &mut v8::HandleScope,
    #[state] ctx: &ExtContext,
    exception: v8::Local<v8::Value>,
) -> bool {
    if let Some(tx) = &ctx.config.exception_tx {
        tx.send(ferr!(
            "unhandledrejection: {}",
            exception.to_rust_string_lossy(scope)
        ))
        .expect_or_log("channel error");
        true
    } else {
        false
    }
}
