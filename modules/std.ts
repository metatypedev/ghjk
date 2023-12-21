import logger from "../utils/logger.ts";
import { PortsModule } from "./ports/mod.ts";
import portsValidators from "./ports/types.ts";
import { type GhjkCtx, type ModuleManifest } from "./types.ts";

export const ports = "ports";

export const tasks = "tasks";

export const map = {
  [ports as string]: {
    ctor: (ctx: GhjkCtx, manifest: ModuleManifest) => {
      const res = portsValidators.portsModuleConfig.safeParse(manifest.config);
      if (!res.success) {
        logger().error("error parsing ports module config", manifest.config);
        throw res.error;
      }
      return new PortsModule(
        ctx,
        res.data,
      );
    },
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
