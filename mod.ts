//! This module is intended to be re-exported by `ghjk.ts` config scripts. Please
//! avoid importing elsewhere at it has side-effects.

import "./setup_logger.ts";

import { type GhjkConfig } from "./modules/ports/types.ts";
// this is only a shortcut for the cli
import { runCli } from "./cli/mod.ts";
import logger from "./utils/logger.ts";
import { GhjkSecureConfig } from "./port.ts";
import * as std_ports from "./modules/ports/std.ts";

// we need to use global variables to allow
// pots to access the config object.
// accessing it through ecma module imports wouldn't work
//  as ports might import a different version of this module.
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
  if (secureConfig?.allowedPortDeps) {
    allowedDeps = new Map();
    for (const depId of secureConfig.allowedPortDeps) {
      const regPort = std_ports.map.get(depId.id);
      if (!regPort) {
        throw new Error(
          `unrecognized dep "${depId.id}" found in "allowedPluginDeps"`,
        );
      }
      allowedDeps.set(depId.id, regPort);
    }
  } else {
    allowedDeps = new Map(std_ports.map.entries());
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
