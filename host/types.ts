import { zod } from "../deps/common.ts";
import moduleValidators from "../modules/types.ts";
import portsValidator from "../modules/ports/types.ts";

const globalEnv = zod.object({
  installs: zod.record(zod.string(), portsValidator.installConfigFat),
  allowedPortDeps: zod.record(zod.string(), portsValidator.allowedPortDep),
});

const serializedConfig = zod.object(
  {
    modules: zod.array(moduleValidators.moduleManifest),
    globalEnv,
  },
);

export type SerializedConfig = zod.infer<typeof serializedConfig>;
export type GlobalEnv = zod.infer<typeof globalEnv>;

export default {
  serializedConfig,
};
