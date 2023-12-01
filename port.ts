//! this provides common exports for Port implementors

import {
  addInstall,
  type AmbientAccessPortManifest,
  type DenoWorkerPortManifest,
  type DownloadArgs,
  type GhjkConfig,
  type InstallConfig,
  type PortBase,
  registerAmbientPlug,
  registerDenoPlug,
  registerPlug,
} from "./modules/ports/mod.ts";
import validators from "./modules/ports/types.ts";
import { log, std_fs, std_path, std_url } from "./deps/plug.ts";
import { initDenoWorkerPlug } from "./modules/ports/worker.ts";
import * as asdf from "./modules/ports/asdf.ts";
import logger, { setup as setupLogger } from "./utils/logger.ts";
import { inWorker } from "./utils/mod.ts";

export * from "./modules/ports/mod.ts";
export * from "./utils/mod.ts";
export * from "./deps/plug.ts";
export { default as logger } from "./utils/logger.ts";
export { initDenoWorkerPlug } from "./modules/ports/worker.ts";
export * as asdf from "./modules/ports/asdf.ts";
export type * from "./modules/ports/mod.ts";
export * from "./utils/unarchive.ts";

if (inWorker()) {
  setupLogger();
}

declare global {
  interface Window {
    // this is null except when we're realmed along `ghjk.ts`
    // i.e. a deno worker port context won't have it avail
    ghjk: GhjkConfig;
  }
}

function isInConfig() {
  return !!self.ghjk;
}

export function registerDenoPlugGlobal<P extends PortBase>(
  manifestUnclean: DenoWorkerPortManifest,
  plugInit: () => P,
) {
  if (isInConfig()) {
    registerDenoPlug(self.ghjk, manifestUnclean);
  } else if (inWorker()) {
    initDenoWorkerPlug(plugInit);
  }
}

export function registerAsdfPort() {
  if (isInConfig()) {
    registerPlug(self.ghjk, {
      ty: "asdf",
      manifest: validators.portManifestBase.parse(asdf.manifest),
    });
  }
}

export function registerAmbientPlugGlobal(
  manifestUnclean: AmbientAccessPortManifest,
) {
  if (isInConfig()) {
    registerAmbientPlug(self.ghjk, manifestUnclean);
  }
}

export function addInstallGlobal(
  config: InstallConfig,
) {
  if (isInConfig()) {
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

export const removeFile = Deno.remove;
