import { zod } from "../deps/common.ts";
import type { Path } from "../utils/mod.ts";

// TODO: better module ident/versioning
const moduleId = zod.string().regex(/[^ @]*/);

export const envsCtxBlackboardKey = "ctx.envs";
export const portsCtxBlackboardKey = "ctx.ports";
export const tasksCtxBlackboardKey = "ctx.tasks";

const moduleManifest = zod.object({
  id: moduleId,
  config: zod.unknown(),
});

export type ModuleId = zod.infer<typeof moduleId>;
export type ModuleManifest = zod.infer<typeof moduleManifest>;
export type GhjkCtx = {
  ghjkfilePath?: Path;
  ghjkDir: Path;
  ghjkShareDir: Path;
  blackboard: Map<string, unknown>;
};

export default {
  moduleManifest,
  moduleId,
};
