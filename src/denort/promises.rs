use crate::interlude::*;

// Lifted from deno_core 0.318.0
/*
MIT License

Copyright 2018-2024 the Deno authors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

 */

/// Wrap a promise with `then` handlers allowing us to watch the resolution progress from a Rust closure.
/// This has a side-effect of preventing unhandled rejection handlers from triggering. If that is
/// desired, the final handler may choose to rethrow the exception.
pub fn watch_promise<'s, F>(
    scope: &mut v8::HandleScope<'s>,
    promise: v8::Local<'s, v8::Promise>,
    f: F,
) -> Option<v8::Local<'s, v8::Promise>>
where
    F: FnOnce(
            &mut v8::HandleScope,
            v8::ReturnValue,
            Result<v8::Local<v8::Value>, v8::Local<v8::Value>>,
        ) + 'static,
{
    let external = v8::External::new(scope, Box::into_raw(Box::new(Some(f))) as _);

    fn get_handler<F>(external: v8::Local<v8::External>) -> F {
        unsafe { Box::<Option<F>>::from_raw(external.value() as _) }
            .take()
            .unwrap()
    }
    let on_fulfilled =
        |scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, rv: v8::ReturnValue| {
            let data = v8::Local::<v8::External>::try_from(args.data()).unwrap();
            let f = get_handler::<F>(data);
            f(scope, rv, Ok(args.get(0)));
        };
    let on_fulfilled = v8::Function::builder(on_fulfilled)
        .data(external.into())
        .build(scope);

    let on_rejected =
        |scope: &mut v8::HandleScope, args: v8::FunctionCallbackArguments, rv: v8::ReturnValue| {
            let data = v8::Local::<v8::External>::try_from(args.data()).unwrap();
            let f = get_handler::<F>(data);
            f(scope, rv, Err(args.get(0)));
        };
    let on_rejected = v8::Function::builder(on_rejected)
        .data(external.into())
        .build(scope);
    // function builders will return None if the runtime is shutting down
    let (Some(on_fulfilled), Some(on_rejected)) = (on_fulfilled, on_rejected) else {
        _ = get_handler::<F>(external);
        return None;
    };

    // then2 will return None if the runtime is shutting down
    let Some(promise) = promise.then2(scope, on_fulfilled, on_rejected) else {
        _ = get_handler::<F>(external);
        return None;
    };

    Some(promise)
}
