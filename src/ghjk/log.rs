use crate::interlude::*;

pub fn init() {
    static INIT: std::sync::Once = std::sync::Once::new();
    INIT.call_once(|| {
        let eyre_panic_hook = color_eyre::config::HookBuilder::default().display_location_section(
            std::env::var("RUST_ERR_LOCATION")
                .map(|var| var != "0")
                .unwrap_or(true),
        );

        #[cfg(not(debug_assertions))]
        let eyre_panic_hook = eyre_panic_hook.panic_section(format!(
            r#"Ghjk has panicked. This is a bug, please report this
at https://github.com/metatypedev/ghjk/issues/new.
If you can reliably reproduce this panic, try to include the
following items in your report:
- Reproduction steps
- Output of meta-cli doctor and
- A panic backtrace. Set the following environment variables as shown to enable full backtraces.
    - RUST_BACKTRACE=1
    - RUST_LIB_BACKTRACE=full
    - RUST_SPANTRACE=1
Platform: {platform}
Version: {version}
Args: {args:?}
"#,
            platform = crate::shadow::BUILD_TARGET,
            // TODO: include commit sha
            version = crate::shadow::PKG_VERSION,
            args = std::env::args().collect::<Vec<_>>()
        ));

        let (eyre_panic_hook, _eyre_hook) = eyre_panic_hook.try_into_hooks().unwrap();
        let eyre_panic_hook = eyre_panic_hook.into_panic_hook();

        std::panic::set_hook(Box::new(move |panic_info| {
            if let Some(msg) = panic_info.payload().downcast_ref::<&str>() {
                if msg.contains("A Tokio 1.x context was found, but it is being shutdown.") {
                    warn!("improper shutdown, make sure to terminate all workers first");
                    return;
                }
            } else if let Some(msg) = panic_info.payload().downcast_ref::<String>() {
                if msg.contains("A Tokio 1.x context was found, but it is being shutdown.") {
                    warn!("improper shutdown, make sure to terminate all workers first");
                    return;
                }
            }
            eyre_panic_hook(panic_info);
            // - Tokio does not exit the process when a task panics, so we define a custom
            //   panic hook to implement this behaviour.
            // std::process::exit(1);
        }));

        // // FIXME: for some reason, the tests already have
        // // an eyre_hook
        // #[cfg(not(test))]
        _eyre_hook.install().unwrap();

        if std::env::var("RUST_LOG").is_err() {
            std::env::set_var("RUST_LOG", "info");
        }
        #[cfg(not(debug_assertions))]
        if std::env::var("RUST_SPANTRACE").is_err() {
            std::env::set_var("RUST_SPANTRACE", "0");
        }

        use tracing_subscriber::prelude::*;

        let fmt = tracing_subscriber::fmt::layer()
            .without_time()
            .with_writer(std::io::stderr)
            // .pretty()
            // .with_file(true)
            // .with_line_number(true)
            .with_target(false);

        #[cfg(test)]
        let fmt = fmt.with_test_writer();

        #[cfg(debug_assertions)]
        let fmt = fmt.with_target(true);

        let filter = tracing_subscriber::EnvFilter::from_default_env();

        let registry = tracing_subscriber::registry();

        #[cfg(feature = "console-subscriber")]
        // FIXME: this isn't being picked up by tokio-console
        let registry = registry.with(console_subscriber::spawn());

        let registry = registry
            // filter on values from RUST_LOG
            .with(filter)
            // subscriber that emits to stderr
            .with(fmt)
            // instrument errors with SpanTraces, used by color-eyre
            .with(tracing_error::ErrorLayer::default());

        registry.init();
        // console_subscriber::init();
    });
}
