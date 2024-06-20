//! NOTE: type FooX is a version of Foo after zod processing/transformation

import { zod } from "../../deps/common.ts";
import envsValidators from "../envs/types.ts";

const taskName = zod.string().regex(/[^\s]/);

const taskDefBase = zod.object({
  ty: zod.string(),
  desc: zod.string().nullish(),
  workingDir: zod.string().nullish(),
  dependsOn: zod.string().array().nullish(),
});

const taskDefFullBase = taskDefBase.merge(zod.object({
  env: envsValidators.envRecipe.optional(),
}));

const taskDefHashedBase = taskDefBase.merge(zod.object({
  envKey: zod.string(),
}));

const denoWorkerTaskDefBase = zod.object({
  ty: zod.literal("denoFile@v1"),
  /**
   * A single module might host multiple tasks so we need keys to identify
   * each with. Names aren't enough since some tasks are anonymous.
   */
  // This field primarily exists as an optimization actually.
  // The tasksModuleConfig keys the tasks by their hash
  // but we use a separate key when asking for exec from the denoFile.
  // This is because the denoFile only constructs the hashes for the config
  // laziliy but uses separate task keys internally due to different hashing concerns.
  // This key will correspond to the internal keys used by the denoFile
  // and not the config.
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
  /**
   * Tasks can be keyed with any old string. The keys
   * that also appear in {@field tasksNamed} will shown
   * in the CLI.
   */
  tasks: zod.record(zod.string(), taskDefHashed),
  tasksNamed: taskName.array(),
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
