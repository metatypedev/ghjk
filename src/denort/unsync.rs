// Modified from https://github.com/denoland/deno_unsync/blob/503a3fcb82235a591a98b497c8d26be5772c6dc9/src/tokio/task.rs
// Copyright 2018-2024 the Deno authors. MIT license.

use core::pin::Pin;
use core::task::Context;
use core::task::Poll;
use std::future::Future;
use std::marker::PhantomData;
use tokio::runtime::Handle;
use tokio::runtime::RuntimeFlavor;

/// Equivalent to [`tokio::task::JoinHandle`].
#[repr(transparent)]
pub struct JoinHandle<R> {
    handle: tokio::task::JoinHandle<MaskResultAsSend<R>>,
    _r: PhantomData<R>,
}

impl<R> JoinHandle<R> {
    /// Equivalent to [`tokio::task::JoinHandle::abort`].
    pub fn abort(&self) {
        self.handle.abort()
    }

    pub fn abort_handle(&self) -> tokio::task::AbortHandle {
        self.handle.abort_handle()
    }
}

impl<R> Future for JoinHandle<R> {
    type Output = Result<R, tokio::task::JoinError>;

    fn poll(
        self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Self::Output> {
        // SAFETY: We are sure that handle is valid here
        unsafe {
            let me: &mut Self = Pin::into_inner_unchecked(self);
            let handle = Pin::new_unchecked(&mut me.handle);
            match handle.poll(cx) {
                Poll::Pending => Poll::Pending,
                Poll::Ready(Ok(r)) => Poll::Ready(Ok(r.into_inner())),
                Poll::Ready(Err(e)) => Poll::Ready(Err(e)),
            }
        }
    }
}

/// Equivalent to [`tokio::task::spawn`], but does not require the future to be [`Send`]. Must only be
/// used on a [`RuntimeFlavor::CurrentThread`] executor, though this is only checked when running with
/// debug assertions.
#[inline(always)]
pub fn spawn<F: Future<Output = R> + 'static, R: 'static>(name: &str, f: F) -> JoinHandle<R> {
    debug_assert!(Handle::current().runtime_flavor() == RuntimeFlavor::CurrentThread);
    // SAFETY: we know this is a current-thread executor
    let future = unsafe { MaskFutureAsSend::new(f) };
    JoinHandle {
        handle: tokio::task::Builder::new()
            .name(name)
            .spawn(future)
            .expect("tokio error"),
        _r: Default::default(),
    }
}

/// Equivalent to [`tokio::task::spawn_blocking`]. Currently a thin wrapper around the tokio API, but this
/// may change in the future.
#[inline(always)]
pub fn spawn_blocking<F: (FnOnce() -> R) + Send + 'static, R: Send + 'static>(
    name: &str,
    f: F,
) -> JoinHandle<R> {
    let handle = tokio::task::Builder::new()
        .name(name)
        .spawn_blocking(|| MaskResultAsSend { result: f() })
        .expect("tokio error");
    JoinHandle {
        handle,
        _r: Default::default(),
    }
}

#[repr(transparent)]
#[doc(hidden)]
pub struct MaskResultAsSend<R> {
    result: R,
}

/// SAFETY: We ensure that Send bounds are only faked when tokio is running on a current-thread executor
unsafe impl<R> Send for MaskResultAsSend<R> {}

impl<R> MaskResultAsSend<R> {
    #[inline(always)]
    pub fn into_inner(self) -> R {
        self.result
    }
}

#[repr(transparent)]
pub struct MaskFutureAsSend<F> {
    future: F,
}

impl<F> MaskFutureAsSend<F> {
    /// Mark a non-`Send` future as `Send`. This is a trick to be able to use
    /// `tokio::spawn()` (which requires `Send` futures) in a current thread
    /// runtime.
    ///
    /// # Safety
    ///
    /// You must ensure that the future is actually used on the same
    /// thread, ie. always use current thread runtime flavor from Tokio.
    #[inline(always)]
    pub unsafe fn new(future: F) -> Self {
        Self { future }
    }
}

// SAFETY: we are cheating here - this struct is NOT really Send,
// but we need to mark it Send so that we can use `spawn()` in Tokio.
unsafe impl<F> Send for MaskFutureAsSend<F> {}

impl<F: Future> Future for MaskFutureAsSend<F> {
    type Output = MaskResultAsSend<F::Output>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<MaskResultAsSend<F::Output>> {
        // SAFETY: We are sure that future is valid here
        unsafe {
            let me: &mut MaskFutureAsSend<F> = Pin::into_inner_unchecked(self);
            let future = Pin::new_unchecked(&mut me.future);
            match future.poll(cx) {
                Poll::Pending => Poll::Pending,
                Poll::Ready(result) => Poll::Ready(MaskResultAsSend { result }),
            }
        }
    }
}

// Copied from https://github.com/denoland/deno_unsync/blob/503a3fcb82235a591a98b497c8d26be5772c6dc9/src/tokio/joinset.rs
// Copyright 2018-2024 the Deno authors. MIT license.
// Some code and comments under MIT license where adapted from Tokio code
// Copyright (c) 2023 Tokio Contributors

use std::task::Waker;
use tokio::task::AbortHandle;
use tokio::task::JoinError;

/// Wraps the tokio [`JoinSet`] to make it !Send-friendly and to make it easier and safer for us to
/// poll while empty.
pub struct JoinSet<T> {
    joinset: tokio::task::JoinSet<MaskResultAsSend<T>>,
    /// If join_next returns Ready(None), we stash the waker
    waker: Option<Waker>,
}

impl<T> Default for JoinSet<T> {
    fn default() -> Self {
        Self {
            joinset: Default::default(),
            waker: None,
        }
    }
}

impl<T: 'static> JoinSet<T> {
    /// Spawn the provided task on the `JoinSet`, returning an [`AbortHandle`]
    /// that can be used to remotely cancel the task.
    ///
    /// The provided future will start running in the background immediately
    /// when this method is called, even if you don't await anything on this
    /// `JoinSet`.
    ///
    /// # Panics
    ///
    /// This method panics if called outside of a Tokio runtime.
    ///
    /// [`AbortHandle`]: tokio::task::AbortHandle
    #[track_caller]
    pub fn spawn<F>(&mut self, task: F) -> AbortHandle
    where
        F: Future<Output = T>,
        F: 'static,
        T: 'static,
    {
        // SAFETY: We only use this with the single-thread executor
        let handle = self.joinset.spawn(unsafe { MaskFutureAsSend::new(task) });

        // If someone had called poll_join_next while we were empty, ask them to poll again
        // so we can properly register the waker with the underlying JoinSet.
        if let Some(waker) = self.waker.take() {
            waker.wake();
        }
        handle
    }

    #[track_caller]
    pub fn spawn_named<F>(&mut self, name: &str, task: F) -> AbortHandle
    where
        F: Future<Output = T>,
        F: 'static,
        T: 'static,
    {
        // SAFETY: We only use this with the single-thread executor
        let handle = self
            .joinset
            .build_task()
            .name(name)
            .spawn(unsafe { MaskFutureAsSend::new(task) })
            .expect("tokio error");

        // If someone had called poll_join_next while we were empty, ask them to poll again
        // so we can properly register the waker with the underlying JoinSet.
        if let Some(waker) = self.waker.take() {
            waker.wake();
        }
        handle
    }

    /// Returns the number of tasks currently in the `JoinSet`.
    pub fn len(&self) -> usize {
        self.joinset.len()
    }

    /// Returns whether the `JoinSet` is empty.
    pub fn is_empty(&self) -> bool {
        self.joinset.is_empty()
    }

    /// Waits until one of the tasks in the set completes and returns its output.
    ///
    /// # Cancel Safety
    ///
    /// This method is cancel safe. If `join_next` is used as the event in a `tokio::select!`
    /// statement and some other branch completes first, it is guaranteed that no tasks were
    /// removed from this `JoinSet`.
    pub fn poll_join_next(&mut self, cx: &mut Context) -> Poll<Result<T, JoinError>> {
        match self.joinset.poll_join_next(cx) {
            Poll::Ready(Some(res)) => Poll::Ready(res.map(|res| res.into_inner())),
            Poll::Ready(None) => {
                // Stash waker
                self.waker = Some(cx.waker().clone());
                Poll::Pending
            }
            Poll::Pending => Poll::Pending,
        }
    }

    /// Waits until one of the tasks in the set completes and returns its output.
    ///
    /// Returns `None` if the set is empty.
    ///
    /// # Cancel Safety
    ///
    /// This method is cancel safe. If `join_next` is used as the event in a `tokio::select!`
    /// statement and some other branch completes first, it is guaranteed that no tasks were
    /// removed from this `JoinSet`.
    pub async fn join_next(&mut self) -> Option<Result<T, JoinError>> {
        self.joinset
            .join_next()
            .await
            .map(|result| result.map(|res| res.into_inner()))
    }

    /// Aborts all tasks on this `JoinSet`.
    ///
    /// This does not remove the tasks from the `JoinSet`. To wait for the tasks to complete
    /// cancellation, you should call `join_next` in a loop until the `JoinSet` is empty.
    pub fn abort_all(&mut self) {
        self.joinset.abort_all();
    }

    /// Removes all tasks from this `JoinSet` without aborting them.
    ///
    /// The tasks removed by this call will continue to run in the background even if the `JoinSet`
    /// is dropped.
    pub fn detach_all(&mut self) {
        self.joinset.detach_all();
    }
}
