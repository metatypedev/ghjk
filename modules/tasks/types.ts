//! NOTE: type FooX is a version of Foo after zod processing/transformation

import { zod } from "../../deps/common.ts";
import { relativeFileUrl } from "../../utils/url.ts";
import envsValidators from "../envs/types.ts";

const taskName = zod.string().regex(/[^\s]/);

const taskDefBase = zod.object({
  ty: zod.string(),
  desc: zod.string().nullish(),
  workingDir: zod.string().nullish(),
  dependsOn: zod.string().array().nullish(),
});

const taskDefFullBase = taskDefBase.merge(zod.object({
  env: envsValidators.envRecipe,
}));

const taskDefHashedBase = taskDefBase.merge(zod.object({
  envHash: zod.string(),
}));

const denoWorkerTaskDefBase = zod.object({
  ty: zod.literal("denoWorker@v1"),
  moduleSpecifier: zod.string().url().transform(relativeFileUrl),
  /**
   * A single module might host multiple tasks so we need keys to identify
   * each with. Names aren't enough since some tasks are anonymous.
   */
  key: zod.string(),
});

const denoWorkerTaskDef = taskDefFullBase.merge(denoWorkerTaskDefBase);
const denoWorkerTaskDefHashed = taskDefHashedBase.merge(denoWorkerTaskDefBase);

const taskDef =
  // zod.discriminatedUnion("ty", [
  denoWorkerTaskDef;
// ]);

const taskDefHashed =
  // zod.discriminatedUnion("ty", [
  denoWorkerTaskDefHashed;
// ]);

const tasksModuleConfig = zod.object({
  envs: zod.record(zod.string(), envsValidators.envRecipe),
  tasks: zod.record(zod.string(), taskDefHashed),
  tasksNamed: zod.record(taskName, zod.string()),
});

const validators = {
  taskDef,
  taskDefHashed,
  denoWorkerTaskDefHashed,
  denoWorkerTaskDef,
  tasksModuleConfig,
};
export default validators;

export type TaskDef = zod.input<typeof validators.taskDef>;
export type TaskDefX = zod.infer<typeof validators.taskDef>;

export type TaskDefHashed = zod.input<typeof validators.taskDefHashed>;
export type TaskDefHashedX = zod.infer<typeof validators.taskDefHashed>;

export type TasksModuleConfig = zod.input<typeof validators.tasksModuleConfig>;
export type TasksModuleConfigX = zod.infer<typeof validators.tasksModuleConfig>;
