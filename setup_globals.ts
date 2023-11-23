import { log } from "./deps/common.ts";
import type { GhjkConfig } from "./core/mod.ts";

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
    console: new log.handlers.ConsoleHandler("NOTSET", {
      formatter: (lr) => {
        let msg = `[${lr.levelName}${
          lr.loggerName ? " " + lr.loggerName : ""
        }] ${lr.msg}`;

        lr.args.forEach((arg, _index) => {
          msg += `, ${JSON.stringify(arg)}`;
        });

        return msg;
      },
      // formatter: "[{loggerName}] - {levelName} {msg}",
    }),
  },

  loggers: {
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
