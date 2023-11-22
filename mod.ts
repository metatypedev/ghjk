//! This module is intended to be re-exported by `ghjk.ts` config scripts. Please
//! avoid importing elsewhere at it has side-effects.

import { log } from "./deps/common.ts";

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

self.ghjk = {
  plugs: new Map(),
  installs: [],
};

log.setup({
  handlers: {
    console: new log.handlers.ConsoleHandler("DEBUG", {
      formatter: (lr) => {
        let msg = `[${lr.levelName} ${lr.loggerName}] ${lr.msg}`;

        lr.args.forEach((arg, _index) => {
          msg += `, ${JSON.stringify(arg)}`;
        });

        return msg;
      },
      // formatter: "[{loggerName}] - {levelName} {msg}",
    }),
  },

  loggers: {
    // configure default logger available via short-hand methods above.
    default: {
      level: "DEBUG",
      handlers: ["console"],
    },
    ghjk: {
      level: "DEBUG",
      handlers: ["console"],
    },
  },
});

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
  cx: self.ghjk,
});

export { logger };
