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
  registerPlug,
  validators,
} from "./core/mod.ts";
import { compress, log, std_fs, std_path, std_url, zip } from "./deps/plug.ts";
import { initDenoWorkerPlug, isWorker } from "./core/worker.ts";
import * as asdf from "./core/asdf.ts";
import logger from "./core/logger.ts";

export * from "./core/mod.ts";
export * from "./core/utils.ts";
export * from "./deps/plug.ts";
export { default as logger } from "./core/logger.ts";
export { initDenoWorkerPlug, isWorker } from "./core/worker.ts";
export * as asdf from "./core/asdf.ts";
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

export function registerAsdfPlug() {
  if (self.ghjk) {
    registerPlug(self.ghjk, {
      ty: "asdf",
      manifest: validators.plugManifestBase.parse(asdf.manifest),
    });
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

/// Uses file extension to determine type
export async function unarchive(
  path: string,
  dest = "./",
  ext = std_path.extname(path),
) {
  switch (ext) {
    case ".gz":
    case ".tar.gz":
    case ".tgz":
      await compress.tgz.uncompress(path, dest);
      break;
    case ".tar":
      await compress.tar.uncompress(path, dest);
      break;
    case ".zip":
      await zip.decompress(path, dest);
      break;
    default:
      throw Error("unsupported archive extension: ${ext}");
  }
}

export const removeFile = Deno.remove;
