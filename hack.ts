//! This file allows an easy way to start with the typescript ghjkfile
//! but is generally insecure for serious usage.
//!
//! If your ghjkfile imports a malicious module, the module could
//! import the functions defined herin and mess with your ghjkfile.
//!
//! For example, it could set `rm -rf / --no-preserve-root` to your
//! main env entry hook!

export * from "./mod.ts";
import { file } from "./mod.ts";

const {
  sophon,
  task,
  env,
  install,
  config,
} = file();

export { config, env, install, sophon, task };
