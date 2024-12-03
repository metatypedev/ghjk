use std::{cell::RefCell, rc::Rc};

use crate::interlude::*;

use deno_core::serde_v8;
use deno_core::v8;
use deno_core::OpState;
#[rustfmt::skip]
use deno_core as deno_core; // necessary for re-exported macros to work
use tokio::sync::{mpsc, oneshot};

use super::ExtConfig;
use super::ExtContext;

#[derive(Debug, thiserror::Error)]
pub enum CallbackError {
    #[error("no callback found under {key}")]
    NotFound { key: String },
    #[error("callback protocol error {0:?}")]
    ProtocolError(eyre::Report),
    #[error("error executing callback {0:?}")]
    JsError(eyre::Report),
    #[error("v8 error {0:?}")]
    V8Error(eyre::Report),
}

/// Line used by the callback_worker to receive
/// invocations.
#[derive(Default)]
pub struct CallbackLine {
    line: Option<tokio::sync::mpsc::Receiver<CallbacksMsg>>,
    was_set: bool,
}

impl CallbackLine {
    pub fn new() -> (Self, CallbacksHandle) {
        let (tx, rx) = tokio::sync::mpsc::channel(1);
        (
            Self {
                was_set: true,
                line: Some(rx),
            },
            CallbacksHandle { sender: tx },
        )
    }

    fn take(&mut self) -> Option<tokio::sync::mpsc::Receiver<CallbacksMsg>> {
        if !self.was_set {
            debug!("callback line was not set, worker callbacks will noop");
            return None;
        }
        match self.line.take() {
            Some(val) => Some(val),
            None => {
                debug!("realm with callbacks just had a child, it won't inherit callback feature");
                None
            }
        }
    }
}

/// Line used to invoke callbacks registered by js code.
#[derive(Clone)]
pub struct CallbacksHandle {
    sender: mpsc::Sender<CallbacksMsg>,
}

impl CallbacksHandle {
    pub async fn exec(
        &self,
        key: CHeapStr,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, CallbackError> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.sender
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
pub fn worker(config: &ExtConfig) -> Option<Callbacks> {
    let mut line = config.callbacks_rx.lock().expect_or_log("mutex err");
    let mut line = line.take()?;

    let callbacks = Callbacks::default();
    let callbacks_2go = callbacks.clone();
    deno_core::unsync::spawn(
        async move {
            trace!("callback worker starting");
            while let Some(msg) = line.recv().await {
                trace!(?msg, "callback worker msg");
                match msg {
                    CallbacksMsg::Exec {
                        key: name,
                        args,
                        response_channel,
                    } => response_channel
                        .send(callbacks_2go.exec_callback(name, args).await)
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
    ) -> Result<serde_json::Value, CallbackError> {
        let Some(cb) = self.store.get(&key[..]).map(|cb| cb.clone()) else {
            return Err(CallbackError::NotFound {
                key: key.to_string(),
            });
        };

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
                        let exception = exception.to_rust_string_lossy(tc_scope);
                        /* let exception = serde_v8::from_v8(tc_scope, exception).map_err(|err| {
                            CallbackError::ProtocolError(
                                ferr!(err).wrap_err("error deserializaing exception from v8"),
                            )
                        })?; */
                        return Err(CallbackError::JsError(ferr!(
                            "callback exception: {exception}"
                        )));
                    }
                    res
                };
                if res.is_promise() {
                    let promise = v8::Local::<v8::Promise>::try_from(res).unwrap();

                    denort::promises::watch_promise(scope, promise, move |scope, _rf, res| {
                        let res = match res {
                            Ok(val) => serde_v8::from_v8(scope, val).map_err(|err| {
                                CallbackError::ProtocolError(
                                    ferr!(err)
                                        .wrap_err("error deserializaing promise result from v8"),
                                )
                            }),
                            Err(err) => Err(CallbackError::JsError(ferr!(
                                "callback promise rejection: {}",
                                err.to_rust_string_lossy(scope)
                            ))), /* Err(err) => match serde_v8::from_v8(scope, err) {
                                     Ok(json) => Err(CallbackError::JsError(json)),
                                     Err(err) => Err(CallbackError::ProtocolError(
                                         ferr!(err)
                                             .wrap_err("error deserializaing promise rejection from v8"),
                                     )),
                                 }, */
                        };
                        tx.send(res).expect_or_log("channel error")
                    });
                    Ok(None)
                } else {
                    let res = serde_v8::from_v8(scope, res).map_err(|err| {
                        CallbackError::ProtocolError(
                            ferr!(err).wrap_err("error deserializaing result from v8"),
                        )
                    })?;
                    Ok(Some(res))
                }
            })
        });

        let res = match join_handle.await.expect_or_log("tokio error")? {
            Some(res) => res,
            None => {
                trace!("waiting for callback proimse");
                rx.await.expect_or_log("channel error")?
            }
        };

        Ok(res)
    }
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

/* impl Callback {
    fn drop(self, scope: &mut v8::HandleScope) {
        unsafe {
            _ = v8::Global::from_raw(scope, self.js_fn.0);
        }
    }
} */

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
    callbacks.store.insert(
        name.into(),
        Callback {
            js_fn: SendPtr(cb.into_raw()),
            async_work_sender,
        },
    );
    Ok(())
}
