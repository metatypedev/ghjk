//! NOTE: type FooX is a version of Foo after zod processing/transformation

import { zod } from "../../deps/common.ts";
import portsValidator from "../ports/types.ts";

const taskName = zod.string().regex(/[^\s]/);

const taskEnvBase = zod.object({
  installs: zod.string().array(),
  env: zod.record(zod.string(), zod.string()),
});

const taskEnv = taskEnvBase.merge(zod.object({
  allowedPortDeps: zod.string().array(),
}));

const taskEnvX = taskEnvBase.merge(zod.object({
  allowedPortDeps: portsValidator.allowedPortDep.array(),
}));

const taskDefBase = zod.object({
  name: zod.string(),
  dependsOn: taskName.array(),
  desc: zod.string().nullish(),
});

const taskDef = taskDefBase.merge(zod.object({
  env: taskEnv,
}));
const taskDefX = taskDefBase.merge(zod.object({
  env: taskEnvX,
}));

const tasksModuleConfig = zod.object({
  tasks: zod.record(taskName, taskDef),
});
const tasksModuleConfigX = zod.object({
  tasks: zod.record(taskName, taskDefX),
});
export default {
  taskDef,
  tasksModuleConfig,
};

export type TaskEnv = zod.input<typeof taskEnv>;
export type TaskEnvX = zod.infer<typeof taskEnv>;
export type TaskDef = zod.input<typeof taskDef>;
export type TaskDefX = zod.infer<typeof taskDefX>;
export type TasksModuleConfig = zod.input<typeof tasksModuleConfig>;
export type TasksModuleConfigX = zod.infer<typeof tasksModuleConfigX>;
