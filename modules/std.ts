import { EnvsModule } from "./envs/mod.ts";
import { PortsModule } from "./ports/mod.ts";
import { TasksModule } from "./tasks/mod.ts";

export const ports = "ports";
export const tasks = "tasks";
export const envs = "envs";

export const map = {
  [ports as string]: {
    ctor: PortsModule,
  },
  [tasks as string]: {
    ctor: TasksModule,
  },
  [envs as string]: {
    ctor: EnvsModule,
  },
};
