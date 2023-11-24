//! This module is intended to be re-exported by `ghjk.ts` config scripts. Please
//! avoid importing elsewhere at it has side-effects.

import "./setup_globals.ts";

import { type GhjkConfig } from "./core/mod.ts";
// this is only a shortcut for the cli
import { runCli } from "./cli/mod.ts";
import logger from "./core/logger.ts";
import { GhjkSecureConfig } from "./plug.ts";
import * as std_plugs from "./std.ts";

// we need to use global variables to allow
// plugins to access the config object.
// module imports wouldn't work as plugins might
// import a different version.
declare global {
  interface Window {
    ghjk: GhjkConfig;
  }
}

function runCliShim(
  args: string[],
  secureConfig: GhjkSecureConfig | undefined,
) {
  let allowedDeps;
  if (secureConfig?.allowedPluginDeps) {
    allowedDeps = new Map();
    for (const depId of secureConfig.allowedPluginDeps) {
      const regPlug = std_plugs.map.get(depId.id);
      if (!regPlug) {
        throw new Error(
          `unrecognized dep "${depId.id}" found in "allowedPluginDeps"`,
        );
      }
      allowedDeps.set(depId.id, regPlug);
    }
  } else {
    allowedDeps = new Map(std_plugs.map.entries());
  }
  runCli(args, {
    ...self.ghjk,
    allowedDeps,
  });
}

// freeze the object to prevent malicious tampering of the secureConfig
export const ghjk = Object.freeze({
  runCli: Object.freeze(runCliShim),
});

export { logger };
