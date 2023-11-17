import {
  addInstall,
  type AmbientAccessPlugManifest,
  type DenoWorkerPlugManifest,
  type GhjkConfig,
  type InstallConfig,
  registerAmbientPlug,
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
      level: "INFO",
      handlers: ["console"],
    },
    ghjk: {
      level: "INFO",
      handlers: ["console"],
    },
    [self.name]: {
      level: "INFO",
      handlers: ["console"],
    },
  },
});

declare global {
  interface Window {
    // this is null except when from from `ghjk.ts`
    // i.e. a deno worker plug context won't have it avail
    ghjk: GhjkConfig;
  }
}

export function registerDenoPlugGlobal(
  manifestUnclean: DenoWorkerPlugManifest,
) {
  if (self.ghjk) {
    if (self.name) throw new Error("impossible");
    registerDenoPlug(self.ghjk, manifestUnclean);
  }
}

export function registerAmbientPlugGlobal(
  manifestUnclean: AmbientAccessPlugManifest,
) {
  if (self.ghjk) {
    registerAmbientPlug(self.ghjk, manifestUnclean);
  }
}

export function addInstallGlobal(
  config: InstallConfig,
) {
  if (self.ghjk) {
    addInstall(self.ghjk, config);
  }
}
