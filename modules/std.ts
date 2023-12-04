import { PortsModule } from "./ports/mod.ts";
import portsValidators from "./ports/types.ts";
import { type GhjkCtx, type ModuleManifest } from "./types.ts";

export const ports = "ports";

export const tasks = "tasks";

export const map = {
  [ports as string]: {
    ctor: (ctx: GhjkCtx, manifest: ModuleManifest) =>
      new PortsModule(
        ctx,
        portsValidators.portsModuleConfig.parse(manifest.config),
      ),
  },
  [tasks as string]: {
    // TODO: impl tasks module
    ctor: (ctx: GhjkCtx, manifest: ModuleManifest) =>
      new PortsModule(
        ctx,
        portsValidators.portsModuleConfig.parse(manifest.config),
      ),
  },
};
