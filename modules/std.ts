import { PortsModule } from "./ports/mod.ts";
import portsValidators from "./ports/types.ts";
import { TasksModule } from "./tasks/mod.ts";
import tasksValidators from "./tasks/types.ts";
import type { GhjkCtx, ModuleManifest } from "./types.ts";

export const ports = "ports";

export const tasks = "tasks";

export const map = {
  [ports as string]: {
    ctor: (ctx: GhjkCtx, manifest: ModuleManifest) => {
      const res = portsValidators.portsModuleConfig.safeParse(manifest.config);
      if (!res.success) {
        throw new Error("error parsing ports module config", {
          cause: {
            config: manifest.config,
            zodErr: res.error,
          },
        });
      }
      return new PortsModule(
        ctx,
        res.data,
      );
    },
  },
  [tasks as string]: {
    ctor: (ctx: GhjkCtx, manifest: ModuleManifest) => {
      const res = tasksValidators.tasksModuleConfig.safeParse(manifest.config);
      if (!res.success) {
        throw new Error("error parsing tasks module config", {
          cause: {
            config: manifest.config,
            zodErr: res.error,
          },
        });
      }
      return new TasksModule(
        ctx,
        res.data,
      );
    },
  },
};
