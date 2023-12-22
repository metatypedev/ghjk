//! NOTE: type FooX is a version of Foo after zod processing/transformation

import { zod } from "../../deps/common.ts";

const taskCmd = zod.object({
  description: zod.string().nullish(),
});
const tasksModuleConfig = zod.object({
  commands: zod.record(zod.string(), taskCmd),
});
export default {
  taskCmd,
  tasksModuleConfig,
};

export type TaskCmd = zod.input<typeof taskCmd>;
export type TaskCmdX = zod.infer<typeof taskCmd>;
export type TasksModuleConfig = zod.input<typeof tasksModuleConfig>;
export type TasksModuleConfigX = zod.infer<typeof tasksModuleConfig>;
