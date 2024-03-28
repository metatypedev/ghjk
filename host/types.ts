import { zod } from "../deps/common.ts";
import moduleValidators from "../modules/types.ts";
// import portsValidator from "../modules/ports/types.ts";

/* const blackboard = zod.object({
  // installs: zod.record(zod.string(), portsValidator.installConfigFat),
  // allowedPortDeps: zod.record(zod.string(), portsValidator.allowedPortDep),
}); */
const blackboard = zod.record(zod.string(), zod.unknown());

const serializedConfig = zod.object(
  {
    modules: zod.array(moduleValidators.moduleManifest),
    blackboard,
  },
);

export type SerializedConfig = zod.infer<typeof serializedConfig>;
export type Blackboard = zod.infer<typeof blackboard>;

export default {
  serializedConfig,
};
