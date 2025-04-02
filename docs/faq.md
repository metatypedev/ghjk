# Frequently Asked Questions

This list is incomplete; you can help by [expanding it](https://github.com/metatypedev/ghjk/discussions).

## How to increase verbosity? 

Set the `GHJK_LOG` environment variable to `debug` to enable more verbose logging.

```bash
export GHJK_LOG=debug
```

For even more logs, one can set the `RUST_LOG` to `debug` or `trace`.
This is usually too verbose to be useful so a more targeted logging level is required.

```bash
export GHJK_LOG='info,ghjk=debug'
```
Setting `info,ghjk=debug`.
Please refer to the tracing [docs](https://docs.rs/tracing-subscriber/latest/tracing_subscriber/filter/struct.EnvFilter.html#directives) to learn how to manage log verbosity per module.
