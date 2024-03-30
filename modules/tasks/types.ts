//! NOTE: type FooX is a version of Foo after zod processing/transformation

import { zod } from "../../deps/common.ts";
import envsValidators from "../envs/types.ts";

const taskName = zod.string().regex(/[^\s]/);

const taskDefBase = zod.object({
  name: zod.string(),
  dependsOn: taskName.array().nullish(),
  desc: zod.string().nullish(),
  workingDir: zod.string().nullish(),
});

const taskDef = taskDefBase.merge(zod.object({
  env: envsValidators.envRecipe,
}));

const taskDefHashed = taskDefBase.merge(zod.object({
  envHash: zod.string(),
}));

const tasksModuleConfig = zod.object({
  envs: zod.record(zod.string(), envsValidators.envRecipe),
  tasks: zod.record(taskName, taskDefHashed),
});

const validators = {
  taskDef,
  taskDefHashed,
  tasksModuleConfig,
};
export default validators;

export type TaskDef = zod.input<typeof validators.taskDef>;
export type TaskDefX = zod.infer<typeof validators.taskDef>;

export type TaskDefHashed = zod.input<typeof validators.taskDefHashed>;
export type TaskDefHashedX = zod.infer<typeof validators.taskDefHashed>;

export type TasksModuleConfig = zod.input<typeof validators.tasksModuleConfig>;
export type TasksModuleConfigX = zod.infer<typeof validators.tasksModuleConfig>;
