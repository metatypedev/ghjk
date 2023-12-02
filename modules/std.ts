import { PortsModule } from "./ports/mod.ts";
import portsValidators from "./ports/types.ts";
import { type ModuleManifest } from "./types.ts";

export const ports = "ports";

export const tasks = "tasks";

export const map = {
  [ports as string]: {
    ctor: (manifest: ModuleManifest) =>
      new PortsModule(
        portsValidators.portsModuleConfig.parse(manifest.config),
      ),
  },
  [tasks as string]: {
    // TODO: impl tasks module
    ctor: (manifest: ModuleManifest) =>
      new PortsModule(
        portsValidators.portsModuleConfig.parse(manifest.config),
      ),
  },
};
