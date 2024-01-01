//! NOTE: type FooX is a version of Foo after zod processing/transformation

import { zod } from "../../deps/common.ts";
import portsValidators from "../ports/types.ts";

const taskName = zod.string().regex(/[^\s]/);

const taskEnv = zod.object({
  installs: portsValidators.installConfigFat.array(),
  allowedPortDeps: zod.record(
    zod.string(),
    portsValidators.allowedPortDep,
  ),
  env: zod.record(zod.string(), zod.string()),
});

const taskDef = zod.object({
  name: zod.string(),
  env: taskEnv,
  dependsOn: taskName.array().nullish(),
  desc: zod.string().nullish(),
});

const tasksModuleConfig = zod.object({
  tasks: zod.record(taskName, taskDef),
});
export default {
  taskDef,
  tasksModuleConfig,
};

export type TaskEnv = zod.input<typeof taskEnv>;
export type TaskEnvX = zod.infer<typeof taskEnv>;
export type TaskDef = zod.input<typeof taskDef>;
export type TaskDefX = zod.infer<typeof taskDef>;
export type TasksModuleConfig = zod.input<typeof tasksModuleConfig>;
export type TasksModuleConfigX = zod.infer<typeof tasksModuleConfig>;
