//! NOTE: type FooX is a version of Foo after zod processing/transformation

import { zod } from "../../deps/common.ts";
import portsValidator from "../ports/types.ts";

const taskName = zod.string().regex(/[^\s]/);

const taskEnvBase = zod.object({
  env: zod.record(zod.string(), zod.string()),
});

const taskEnvHashed = taskEnvBase.merge(zod.object({
  installs: zod.string().array(),
  allowedPortDeps: zod.record(zod.string(), zod.string()),
}));

const taskEnv = taskEnvBase.merge(zod.object({
  installs: portsValidator.installConfigFat.array(),
  allowedPortDeps: zod.record(
    zod.string(),
    portsValidator.allowedPortDep,
  ),
}));

const taskDefBase = zod.object({
  name: zod.string(),
  dependsOn: taskName.array(),
  desc: zod.string().nullish(),
});

const taskDef = taskDefBase.merge(zod.object({
  env: taskEnv,
}));

const taskDefHashed = taskDefBase.merge(zod.object({
  env: taskEnvHashed,
}));

const tasksModuleConfig = zod.object({
  tasks: zod.record(taskName, taskDef),
});

const tasksModuleConfigHashed = zod.object({
  tasks: zod.record(taskName, taskDefHashed),
});

const validators = {
  taskEnv,
  taskEnvHashed,
  taskDef,
  taskDefHashed,
  tasksModuleConfig,
  tasksModuleConfigHashed,
};
export default validators;

export type TaskEnv = zod.input<typeof validators.taskEnv>;
export type TaskEnvX = zod.infer<typeof validators.taskEnv>;

export type TaskEnvHashed = zod.input<typeof validators.taskEnvHashed>;
export type TaskEnvHashedX = zod.infer<typeof validators.taskEnvHashed>;

export type TaskDef = zod.input<typeof validators.taskDef>;
export type TaskDefX = zod.infer<typeof validators.taskDef>;

export type TaskDefHashed = zod.input<typeof validators.taskDefHashed>;
export type TaskDefHashedX = zod.infer<typeof validators.taskDefHashed>;

export type TasksModuleConfig = zod.input<typeof validators.tasksModuleConfig>;
export type TasksModuleConfigX = zod.infer<typeof validators.tasksModuleConfig>;

export type TasksModuleConfigHashed = zod.input<
  typeof validators.tasksModuleConfigHashed
>;
export type TasksModuleConfigHashedX = zod.infer<
  typeof tasksModuleConfigHashed
>;
