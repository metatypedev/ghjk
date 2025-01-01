use std::{cell::RefCell, rc::Rc};

use crate::interlude::*;

use deno_core::serde_v8;
use deno_core::v8;
use deno_core::OpState;
// necessary for re-exported macros to work
#[rustfmt::skip]
use deno_core as deno_core;
use tokio::sync::{mpsc, oneshot};

use super::ExtConfig;
use super::ExtContext;

#[derive(Debug, thiserror::Error)]
pub enum CallbackError {
    #[error("no callback found under {key}")]
    NotFound { key: String },
    #[error("callback protocol error")]
    ProtocolError(#[source] eyre::Report),
    #[error("error executing callback")]
    JsError(#[source] eyre::Report),
    #[error("v8 error")]
    V8Error(#[source] eyre::Report),
}

struct CallbackCtx {
    msg_rx: mpsc::Receiver<CallbacksMsg>,
    term_signal: tokio::sync::watch::Receiver<bool>,
}

/// Line used by the callback_worker to receive
/// invocations.
#[derive(Default)]
pub struct CallbackLine {
    /// This would be None if the callback line was already
    /// taken or if the callback line was not initially set
    cx: Option<CallbackCtx>,
    /// Indicates weather the callback line was initially set
    was_set: bool,
}

impl CallbackLine {
    pub fn new(dworker: &denort::worker::DenoWorkerHandle) -> (Self, CallbacksHandle) {
        let (msg_tx, msg_rx) = mpsc::channel(1);
        (
            Self {
                was_set: true,
                cx: Some(CallbackCtx {
                    msg_rx,
                    term_signal: dworker.term_signal_watcher(),
                }),
            },
            CallbacksHandle { msg_tx },
        )
    }

    fn take(&mut self) -> Option<CallbackCtx> {
        if !self.was_set {
            // debug!("callback line was not set, worker callbacks will noop");
            return None;
        }
        // debug!("realm with callbacks just had a child, it won't inherit callback feature");
        self.cx.take()
    }
}

/// Line used to invoke callbacks registered by js code.
#[derive(Clone)]
pub struct CallbacksHandle {
    msg_tx: mpsc::Sender<CallbacksMsg>,
}

impl CallbacksHandle {
    pub async fn exec(
        &self,
        key: CHeapStr,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, CallbackError> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.msg_tx
            .send(CallbacksMsg::Exec {
                response_channel: tx,
                key,
                args,
            })
            .await
            .expect_or_log("channel error");
        rx.await.expect_or_log("channel error")
    }
}

/// Internal used to communicate between callback worker
#[derive(educe::Educe)]
#[educe(Debug)]
enum CallbacksMsg {
    Exec {
        #[educe(Debug(ignore))]
        response_channel: oneshot::Sender<Result<serde_json::Value, CallbackError>>,
        key: CHeapStr,
        #[educe(Debug(ignore))]
        args: serde_json::Value,
    },
}

#[derive(Clone, Default)]
pub struct Callbacks {
    store: Arc<DHashMap<CHeapStr, Callback>>,
}

/// Start a worker task to execute callbacks on.
///
/// Stored callbacks are not Sync so this expects to be started
/// on the same thread as deno.
/// This will return none if the callback line was set or
/// the callback line was already taken. This happens
/// with child WebWorkers for example which don't currently
/// support callbacks.
pub fn worker(config: &ExtConfig) -> Option<Callbacks> {
    let CallbackCtx {
        msg_rx: mut rx,
        term_signal,
    } = {
        let mut line = config.callbacks_rx.lock().expect_or_log("mutex err");
        line.take()?
    };

    let callbacks = Callbacks::default();
    let callbacks_2go = callbacks.clone();
    denort::unsync::spawn(
        "callback-worker",
        async move {
            trace!("callback worker starting");
            while let Some(msg) = rx.recv().await {
                trace!(?msg, "msg");
                match msg {
                    CallbacksMsg::Exec {
                        key: name,
                        args,
                        response_channel,
                    } => response_channel
                        .send(
                            callbacks_2go
                                .exec_callback(name, args, term_signal.clone())
                                .await,
                        )
                        .expect_or_log("channel error"),
                }
            }
            trace!("callback worker done");
        }
        .instrument(tracing::trace_span!("callback-worker")),
    );
    Some(callbacks)
}

impl Callbacks {
    #[tracing::instrument(skip(self, args))]
    pub async fn exec_callback(
        &self,
        key: CHeapStr,
        args: serde_json::Value,
        mut term_signal: tokio::sync::watch::Receiver<bool>,
    ) -> Result<serde_json::Value, CallbackError> {
        let Some(cb) = self.store.get(&key[..]).map(|cb| cb.clone()) else {
            return Err(CallbackError::NotFound {
                key: key.to_string(),
            });
        };

        if *term_signal.borrow_and_update() {
            trace!("callback invoked on terminated runtime");
            return Err(CallbackError::V8Error(ferr!("deno is shutting down")));
        }

        let (tx, rx) = oneshot::channel::<Result<serde_json::Value, CallbackError>>();

        // we use the sender to spawn work on the v8 thread
        let join_handle = tokio::task::spawn_blocking(move || {
            cb.async_work_sender.spawn_blocking(move |scope| {
                let args = serde_v8::to_v8(scope, args).map_err(|err| {
                    CallbackError::V8Error(ferr!(err).wrap_err("error serializaing args to v8"))
                })?;

                let recv = v8::undefined(scope);

                let res = {
                    let tc_scope = &mut v8::TryCatch::new(scope);
                    // FIXME(@yohe): the original pointer was made from a global
                    // and yet we're transmuting it to a Local here.
                    // This is observed from the deno codebase
                    // and I can't explain it
                    // SAFETY: cargo culted from deno codebase
                    let func = unsafe {
                        std::mem::transmute::<SendPtr<v8::Function>, v8::Local<v8::Function>>(
                            cb.js_fn,
                        )
                    };

                    let res = func
                        .call(tc_scope, recv.into(), &[args])
                        // FIXME: under what circumstances can this be None?
                        .expect_or_log("got None from callback call");
                    if tc_scope.has_caught() {
                        let exception = tc_scope.exception().unwrap();
                        return Err(CallbackError::JsError(
                            ferr!(js_error_message(tc_scope, exception))
                                .wrap_err("callback exception"),
                        ));
                    }
                    res
                };
                if !res.is_promise() {
                    let res = serde_v8::from_v8(scope, res).map_err(|err| {
                        CallbackError::ProtocolError(
                            ferr!(err).wrap_err("error deserializaing result from v8"),
                        )
                    })?;
                    return Ok(Some(res));
                }
                let promise = v8::Local::<v8::Promise>::try_from(res).unwrap();
                let deno_shutting_down =
                    denort::promises::watch_promise(scope, promise, move |scope, _rf, res| {
                        let res = match res {
                            Ok(val) => serde_v8::from_v8(scope, val).map_err(|err| {
                                CallbackError::ProtocolError(
                                    ferr!(err)
                                        .wrap_err("error deserializaing promise result from v8"),
                                )
                            }),
                            // FIXME: this is a bit of a mess and a bunch of workaround
                            // for private deno_core functionality as discussed at
                            // https://github.com/denoland/deno/discussions/27504
                            Err(err) => Err(CallbackError::JsError(
                                ferr!(js_error_message(scope, err))
                                    .wrap_err("callback promise rejection"),
                            )),
                        };
                        if let Err(res) = tx.send(res) {
                            debug!(?res, "callback response after abortion");
                        }
                    })
                    .is_none();
                if deno_shutting_down {
                    return Err(CallbackError::V8Error(ferr!("js runtime is shutting down")));
                };
                Ok(None)
            })
        });

        // if the callback is not async, we recieve the value right away
        if let Some(res) = join_handle.await.expect_or_log("tokio error")? {
            return Ok(res);
        };

        let res = tokio::select! {
            _ = term_signal.wait_for(|signal| *signal) => {
                trace!("callback worker recieved term signal");
                return Err(CallbackError::V8Error(ferr!("deno terminated waiting on callback")));
            },
            res = rx => {
                res.expect_or_log("channel error")?
            }
        };

        Ok(res)
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

struct Callback {
    js_fn: SendPtr<v8::Function>,
    async_work_sender: deno_core::V8CrossThreadTaskSpawner,
}

impl Clone for Callback {
    fn clone(&self) -> Self {
        Self {
            js_fn: SendPtr(self.js_fn.0),
            async_work_sender: self.async_work_sender.clone(),
        }
    }
}

#[derive(Clone, Copy)]
#[repr(transparent)]
struct SendPtr<T>(std::ptr::NonNull<T>);
// SAFETY: we only ever access this value from within the same thread
// as deno
unsafe impl<T> Send for SendPtr<T> {}

#[tracing::instrument(skip(state, cb))]
#[deno_core::op2]
pub fn op_callbacks_set(
    state: Rc<RefCell<OpState>>,
    #[string] name: String,
    #[global] cb: v8::Global<v8::Function>,
) -> anyhow::Result<()> {
    let (ctx, async_work_sender) = {
        let state = state.borrow();
        let ctx = state.borrow::<ExtContext>();
        let sender = state.borrow::<deno_core::V8CrossThreadTaskSpawner>();

        (ctx.clone(), sender.clone())
    };
    let Some(callbacks) = ctx.callbacks else {
        warn!("callback set but callback feature is not enabled");
        anyhow::bail!("callbacks feature is not enabled");
    };
    debug!(%name, "registering callback");
    callbacks.store.insert(
        name.into(),
        Callback {
            js_fn: SendPtr(cb.into_raw()),
            async_work_sender,
        },
    );
    Ok(())
}
