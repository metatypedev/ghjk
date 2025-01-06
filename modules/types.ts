import { zod } from "../deps/common.ts";
import type { Path } from "../utils/mod.ts";

// TODO: better module ident/versioning
const moduleId = zod.string().regex(/[^ @]*/);

const envVarName = zod.string().regex(/[a-zA-Z-_]*/);

const moduleManifest = zod.object({
  id: moduleId,
  config: zod.unknown(),
});

/* const blackboard = zod.object({
  // installs: zod.record(zod.string(), portsValidator.installConfigFat),
  // allowedPortDeps: zod.record(zod.string(), portsValidator.allowedPortDep),
}); */
const blackboard = zod.record(zod.string(), zod.unknown());

export type Blackboard = zod.infer<typeof blackboard>;
export type ModuleId = zod.infer<typeof moduleId>;
export type ModuleManifest = zod.infer<typeof moduleManifest>;
export type GhjkCtx = {
  ghjkfilePath?: Path;
  ghjkDir: Path;
  ghjkDataDir: Path;
  blackboard: Map<string, unknown>;
};

export default {
  moduleManifest,
  moduleId,
  envVarName,
  blackboard,
};
