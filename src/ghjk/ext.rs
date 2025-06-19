use crate::interlude::*;

use std::{cell::RefCell, rc::Rc};

use deno_core::OpState;
use tokio::sync::mpsc;
#[rustfmt::skip]
use deno_core as deno_core; // necessary for re-exported macros to work

mod callbacks;
pub use callbacks::CallbacksHandle;

/// This extension assumes that deno was launched on top of a tokio::LocalSet
pub fn extensions(config: ExtConfig) -> Arc<denort::deno::deno_lib::worker::CustomExtensionsCb> {
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
) -> Result<serde_json::Value, OpErr> {
    let ctx = {
        let state = state.borrow();
        let ctx = state.borrow::<ExtContext>();
        ctx.clone()
    };
    let Some(func) = ctx.config.hostcalls.funcs.get(&name[..]) else {
        return Err(OpErr(ferr!("no hostcall found under {name}")));
    };
    func(args).await.map_err(OpErr)
}

#[deno_core::op2(fast)]
pub fn op_dispatch_exception2(
    scope: &mut v8::HandleScope,
    #[state] ctx: &ExtContext,
    exception: v8::Local<v8::Value>,
) -> bool {
    if let Some(tx) = &ctx.config.exception_tx {
        tx.send(ferr!(js_error_message(scope, exception)).wrap_err("unhandledrejection"))
            .expect_or_log("channel error");
        true
    } else {
        false
    }
}

fn js_error_message(scope: &mut v8::HandleScope, err: v8::Local<v8::Value>) -> String {
    let Some(obj) = err.to_object(scope) else {
        return err.to_rust_string_lossy(scope);
    };
    let evt_err_class = {
        let name = v8::String::new(scope, "ErrorEvent")
            .expect_or_log("v8 error")
            .into();
        scope
            .get_current_context()
            // classes are stored on the global obj
            .global(scope)
            .get(scope, name)
            .expect_or_log("v8 error")
            .to_object(scope)
            .expect_or_log("v8 error")
    };
    if !obj
        .instance_of(scope, evt_err_class)
        .expect_or_log("v8 error")
    {
        for key in &["stack", "message"] {
            let key = v8::String::new(scope, key).expect_or_log("v8 error");
            if let Some(inner) = obj.get(scope, key.into()) {
                if inner.boolean_value(scope) {
                    return inner.to_rust_string_lossy(scope);
                }
            }
        }
        return err.to_rust_string_lossy(scope);
    }
    // ErrorEvents are recieved here for some reason
    // https://developer.mozilla.org/en-US/docs/Web/API/ErrorEvent
    {
        // if it has an error value attached, prefer that
        let key = v8::String::new(scope, "error")
            .expect_or_log("v8 error")
            .into();
        if let Some(inner) = obj.get(scope, key) {
            // check if it's not null or undefined
            if inner.boolean_value(scope) {
                // stack messages are preferred if it has one
                let Some(inner) = inner.to_object(scope) else {
                    return inner.to_rust_string_lossy(scope);
                };
                let key = v8::String::new(scope, "stack").expect_or_log("v8 error");
                if let Some(stack) = inner.get(scope, key.into()) {
                    if stack.boolean_value(scope) {
                        return stack.to_rust_string_lossy(scope);
                    }
                }
                return inner.to_rust_string_lossy(scope);
            }
        }
    }
    #[derive(Deserialize)]
    struct ErrorEvt {
        lineno: i64,
        colno: i64,
        filename: String,
        message: String,
    }
    let evt: ErrorEvt = serde_v8::from_v8(scope, err).unwrap();
    format!(
        "{} ({}:{}:{})",
        evt.message, evt.filename, evt.lineno, evt.colno
    )
}

use utils::OpErr;
mod utils {
    use crate::interlude::*;

    #[derive(Debug)]
    pub struct OpErr(pub eyre::Report);
    impl From<eyre::Report> for OpErr {
        fn from(err: eyre::Report) -> Self {
            Self(err)
        }
    }
    impl OpErr {
        pub fn get_error_class(_: &eyre::Report) -> impl Into<std::borrow::Cow<'static, str>> {
            "Error"
        }
        // pub fn map<T: Into<eyre::Report>>() -> fn(T) -> Self {
        //     |err| OpErr(ferr!(err))
        // }
    }
    impl std::error::Error for OpErr {
        fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
            self.0.source()
        }
    }
    impl std::fmt::Display for OpErr {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            std::fmt::Display::fmt(&self.0, f)
        }
    }
    impl deno::deno_error::JsErrorClass for OpErr {
        fn get_class(&self) -> std::borrow::Cow<'static, str> {
            Self::get_error_class(&self.0).into()
        }
        fn get_message(&self) -> std::borrow::Cow<'static, str> {
            self.to_string().into()
        }
        fn get_additional_properties(
            &self,
        ) -> Vec<(
            std::borrow::Cow<'static, str>,
            std::borrow::Cow<'static, str>,
        )> {
            vec![]
        }
        fn as_any(&self) -> &dyn std::any::Any {
            self
        }
    }
    impl std::ops::Deref for OpErr {
        type Target = eyre::Report;

        fn deref(&self) -> &Self::Target {
            &self.0
        }
    }
}
