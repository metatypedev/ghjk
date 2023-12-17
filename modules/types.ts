import { zod } from "../deps/common.ts";

// FIXME: better module ident/versioning
const moduleId = zod.string();

const moduleManifest = zod.object({
  id: moduleId,
  config: zod.unknown(),
});

export type ModuleId = zod.infer<typeof moduleId>;
export type ModuleManifest = zod.infer<typeof moduleManifest>;
export type GhjkCtx = {
  configPath: string;
  envDir: string;
  ghjkDir: string;
};

export default {
  moduleManifest,
  moduleId,
};
