import type { DenoSystemsRoot } from "./types.ts";
import { PortsModule } from "./ports/mod.ts";

export const ports = "ports";

export const map = {
  [ports as string]: {
    ctor: PortsModule,
  },
};

export default {
  systems: Object.fromEntries(
    Object.entries(map).map(
      ([id, sys]) => [id, (gcx) => new sys.ctor(gcx)],
    ),
  ),
} satisfies DenoSystemsRoot;
