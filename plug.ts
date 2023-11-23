import {
  addInstall,
  type AmbientAccessPlugManifest,
  type DenoWorkerPlugManifest,
  type DepShims,
  type DownloadArgs,
  type GhjkConfig,
  type InstallConfig,
  type PlugBase,
  type PlugDep,
  registerAmbientPlug,
  registerDenoPlug,
} from "./core/mod.ts";
import { log, std_fs, std_path, std_url } from "./deps/plug.ts";
import { initDenoWorkerPlug, isWorker } from "./core/worker.ts";
import logger from "./core/logger.ts";

export * from "./core/mod.ts";
export * from "./core/utils.ts";
export * from "./deps/plug.ts";
export { default as logger } from "./core/logger.ts";
export { initDenoWorkerPlug, isWorker, workerSpawn } from "./core/worker.ts";
export type * from "./core/mod.ts";

if (isWorker()) {
  log.setup({
    handlers: {
      console: new log.handlers.ConsoleHandler("NOTSET", {
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
}

declare global {
  interface Window {
    // this is null except when from from `ghjk.ts`
    // i.e. a deno worker plug context won't have it avail
    ghjk: GhjkConfig;
  }
}

export function registerDenoPlugGlobal<P extends PlugBase>(
  manifestUnclean: DenoWorkerPlugManifest,
  plugInit: () => P,
) {
  if (self.ghjk) {
    if (isWorker()) throw new Error("literally impossible!");
    registerDenoPlug(self.ghjk, manifestUnclean);
  } else {
    initDenoWorkerPlug(plugInit);
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

export function depBinShimPath(
  dep: PlugDep,
  binName: string,
  depShims: DepShims,
) {
  const shimPaths = depShims[dep.id];
  if (!shimPaths) {
    throw new Error(`unable to find shims for dep ${dep.id}`);
  }
  const path = shimPaths[binName];
  if (!path) {
    throw new Error(
      `unable to find shim path for bin "${binName}" of dep ${dep.id}`,
    );
  }
  return path;
}

/// This avoid re-downloading a file if it's already successfully downloaded before.
export async function downloadFile(
  env: DownloadArgs,
  url: string,
  options: {
    fileName?: string;
    mode?: number;
  } = {},
) {
  const { fileName, mode } = {
    fileName: std_url.basename(url),
    mode: 0o666,
    ...options,
  };
  const fileDwnPath = std_path.resolve(env.downloadPath, fileName);
  if (await std_fs.exists(fileDwnPath)) {
    logger().debug(`file ${fileName} already downloaded, skipping`);
    return;
  }
  const tmpFilePath = std_path.resolve(
    env.tmpDirPath,
    fileName,
  );

  const resp = await fetch(url);

  if (!resp.ok) {
    throw new Error(
      `${resp.status}: ${resp.statusText} downloading file at ${url}`,
    );
  }
  const length = resp.headers.get("content-length");
  logger().debug(
    `downloading file: `,
    {
      fileSize: length ? Number(length) / 1024 : "N/A",
      url,
      to: fileDwnPath,
    },
  );

  const dest = await Deno.open(
    tmpFilePath,
    { create: true, truncate: true, write: true, mode },
  );
  await resp.body!.pipeTo(dest.writable, { preventClose: false });
  await std_fs.ensureDir(env.downloadPath);
  await std_fs.copy(
    tmpFilePath,
    fileDwnPath,
  );
}

export const removeFile = Deno.remove;
