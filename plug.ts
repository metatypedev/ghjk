import {
  addInstall,
  type DenoWorkerPlugManifest,
  type GhjkCtx,
  type InstallConfig,
  registerDenoPlug,
} from "./core/mod.ts";
import { log } from "./deps/plug.ts";

export * from "./core/mod.ts";
export * from "./deps/plug.ts";
export { default as logger } from "./core/logger.ts";
export { denoWorkerPlug } from "./core/worker.ts";
export type * from "./core/mod.ts";

log.setup({
  handlers: {
    console: new log.handlers.ConsoleHandler("DEBUG", {
      formatter: (lr) => {
        let msg = `[${lr.levelName} ${lr.loggerName}] ${lr.msg}`;

        lr.args.forEach((arg, _index) => {
          msg += `, ${JSON.stringify(arg)}`;
        });
        // if (lr.args.length > 0) {
        //   msg += JSON.stringify(lr.args);
        // }

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
    [self.name]: {
      level: "DEBUG",
      handlers: ["console"],
    },
  },
});

declare global {
  interface Window {
    ghjk: GhjkCtx;
  }
}

export function registerDenoPlugGlobal(
  manifestUnclean: DenoWorkerPlugManifest,
) {
  // make sure we're not running in a Worker first
  if (!self.name) {
    registerDenoPlug(self.ghjk, manifestUnclean);
  }
}

export function addInstallGlobal(
  config: InstallConfig,
) {
  if (!self.name) {
    addInstall(self.ghjk, config);
  }
}
