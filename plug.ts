import {
  addInstall,
  type GhjkCtx,
  type InstallConfig,
  type PlugManifestBase,
  registerPlug,
} from "./core/mod.ts";

export * from "./core/mod.ts";
export { denoWorkerPlug } from "./core/worker.ts";
export type * from "./core/mod.ts";

declare global {
  interface Window {
    ghjk: GhjkCtx;
  }
}

export function registerPlugGlobal(
  manifestUnclean: PlugManifestBase,
) {
  // make sure we're not running in a Worker first
  if (!self.name) {
    registerPlug(self.ghjk, manifestUnclean);
  }
}

export function addInstallGlobal(
  config: InstallConfig,
) {
  if (!self.name) {
    addInstall(self.ghjk, config);
  }
}
