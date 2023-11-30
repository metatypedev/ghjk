import {
  addInstall,
  type AmbientAccessPlugManifest,
  type DenoWorkerPlugManifest,
  type DownloadArgs,
  type GhjkConfig,
  type InstallConfig,
  type PlugBase,
  registerAmbientPlug,
  registerDenoPlug,
  registerPlug,
  validators,
} from "./core/mod.ts";
import {
  compress,
  Foras,
  log,
  std_fs,
  std_io,
  std_path,
  std_streams,
  std_tar,
  std_url,
  zipjs,
} from "./deps/plug.ts";
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
      await untgz(path, dest);
      break;
    case ".tar":
      await untar(path, dest);
      break;
    case ".zip":
      await unzip(path, dest);
      break;
    default:
      throw Error("unsupported archive extension: ${ext}");
  }
}

export async function untgz(
  path: string,
  dest = "./",
) {
  // FIXME: replace Foras with zip.js from below if possible
  // this unzips the whole thing into memory first
  // but I was not able to figure out the
  await Foras.initBundledOnce();
  const tgzFile = await Deno.open(path, { read: true });
  const gzDec = new Foras.GzDecoder();
  await std_streams.copy(tgzFile, {
    write(buf) {
      const mem = new Foras.Memory(buf);
      gzDec.write(mem);
      mem.freeNextTick();
      return Promise.resolve(buf.length);
    },
  });
  const buf = gzDec.finish().copyAndDispose();
  await untarReader(new std_io.Buffer(buf), dest);
}
export async function untar(
  path: string,
  dest = "./",
) {
  const tarFile = await Deno.open(path, {
    read: true,
  });

  try {
    await untarReader(tarFile, dest);
  } catch (err) {
    throw err;
  } finally {
    tarFile.close();
  }
}

/// This does not close the reader
export async function untarReader(
  reader: Deno.Reader,
  dest = "./",
) {
  for await (const entry of new std_tar.Untar(reader)) {
    const filePath = std_path.resolve(dest, entry.fileName);
    if (entry.type === "directory") {
      await std_fs.ensureDir(filePath);
      return;
    }
    await std_fs.ensureDir(std_path.dirname(filePath));
    const file = await Deno.open(filePath, {
      create: true,
      truncate: true,
      write: true,
      mode: entry.fileMode,
    });
    await std_streams.copy(entry, file);
    file.close();
  }
}

export async function unzip(
  path: string,
  dest = "./",
) {
  const zipFile = await Deno.open(path, { read: true });
  const zipReader = new zipjs.ZipReader(zipFile.readable);
  try {
    await Promise.allSettled(
      (await zipReader.getEntries()).map(async (entry) => {
        const filePath = std_path.resolve(dest, entry.filename);
        if (entry.directory) {
          await std_fs.ensureDir(filePath);
          return;
        }
        await std_fs.ensureDir(std_path.dirname(filePath));
        const file = await Deno.open(filePath, {
          create: true,
          truncate: true,
          write: true,
          mode: entry.externalFileAttribute >> 16,
        });
        if (!entry.getData) throw Error("impossible");
        await entry.getData(file.writable);
      }),
    );
  } catch (err) {
    throw err;
  } finally {
    zipReader.close();
  }
}

export const removeFile = Deno.remove;
