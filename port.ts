//! this provides common exports for Port implementors

import {
  addInstall,
  type AmbientAccessPortManifest,
  type DenoWorkerPortManifest,
  type DownloadArgs,
  type InstallConfig,
  PortBase,
  type PortsModuleConfigBase,
  registerAmbientPort,
  registerDenoPort,
  registerPort,
} from "./modules/ports/mod.ts";
import { std_url } from "./deps/ports.ts";
import { initDenoWorkerPort } from "./modules/ports/worker.ts";
import * as asdf from "./modules/ports/asdf.ts";
import logger, { setup as setupLogger } from "./utils/logger.ts";
import { $, inWorker } from "./utils/mod.ts";

export * from "./modules/ports/mod.ts";
export * from "./utils/mod.ts";
export * from "./deps/ports.ts";
export { default as logger } from "./utils/logger.ts";
export { initDenoWorkerPort } from "./modules/ports/worker.ts";
export * as asdf from "./modules/ports/asdf.ts";
export type * from "./modules/ports/mod.ts";
export { GithubReleasePort } from "./modules/ports/ghrel.ts";
export * from "./utils/unarchive.ts";

if (inWorker()) {
  setupLogger();
}

declare global {
  interface Window {
    // this is null except when we're realmed along `ghjk.ts`
    // i.e. a deno worker port context won't have it avail
    ports: PortsModuleConfigBase;
  }
}

function isInConfig() {
  return !!self.ports;
}

export function registerDenoPortGlobal<P extends PortBase>(
  manifest: DenoWorkerPortManifest,
  portCtor: () => P,
) {
  if (isInConfig()) {
    registerDenoPort(self.ports, manifest);
  } else if (inWorker()) {
    initDenoWorkerPort(portCtor);
  }
}

export function registerAsdfPort() {
  if (isInConfig()) {
    registerPort(self.ports, asdf.manifest);
  }
}

export function registerAmbientPortGlobal(
  manifestUnclean: AmbientAccessPortManifest,
) {
  if (isInConfig()) {
    registerAmbientPort(self.ports, manifestUnclean);
  }
}

export function addInstallGlobal(
  config: InstallConfig,
) {
  if (isInConfig()) {
    addInstall(self.ports, config);
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
  const fileDwnPath = $.path(env.downloadPath).join(fileName);
  if (await fileDwnPath.exists()) {
    logger().debug(`file ${fileName} already downloaded, skipping`);
    return;
  }
  const tmpFilePath = $.path(env.tmpDirPath).join(fileName);

  await $.request(url)
    .showProgress()
    .pipeToPath(tmpFilePath, { create: true, mode });

  await $.path(env.downloadPath).ensureDir();

  await tmpFilePath.copyFile(fileDwnPath);
}

export const removeFile = Deno.remove;
