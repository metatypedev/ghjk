import { zod } from "../deps/common.ts";

// TODO: better module ident/versioning
const moduleId = zod.string().regex(/[^ @]*/);

const moduleManifest = zod.object({
  id: moduleId,
  config: zod.unknown(),
});

export type ModuleId = zod.infer<typeof moduleId>;
export type ModuleManifest = zod.infer<typeof moduleManifest>;
export type GhjkCtx = {
  ghjkfilePath: string;
  ghjkDir: string;
  ghjkShareDir: string;
  state: Map<string, unknown>;
};

export default {
  moduleManifest,
  moduleId,
};
