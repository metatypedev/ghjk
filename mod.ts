//! This module is intended to be re-exported by `ghjk.ts` config scripts. Please
//! avoid importing elsewhere at it has side-ffects.

import { log } from "./deps/common.ts";

import { type GhjkCtx } from "./core/mod.ts";
// this is only a shortcut for the cli
import { runCli } from "./cli/mod.ts";
import logger from "./core/logger.ts";

declare global {
  interface Window {
    ghjk: GhjkCtx;
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

export const ghjk = {
  runCli: (args: string[]) => runCli(args, self.ghjk),
  cx: self.ghjk,
};

export { logger };
