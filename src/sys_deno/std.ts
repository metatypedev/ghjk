import type { DenoSystemsRoot } from "./types.ts";
// EnvsModule removed - now implemented in Rust
import { PortsModule } from "./ports/mod.ts";
import { TasksModule } from "./tasks/mod.ts";

export const ports = "ports";
export const tasks = "tasks";
// envs system now implemented in Rust

export const map = {
  [ports as string]: {
    ctor: PortsModule,
  },
  [tasks as string]: {
    ctor: TasksModule,
  },
  // envs system now implemented in Rust
};

export default {
  systems: Object.fromEntries(
    Object.entries(map).map(
      ([id, sys]) => [id, (gcx) => new sys.ctor(gcx)],
    ),
  ),
} satisfies DenoSystemsRoot;
