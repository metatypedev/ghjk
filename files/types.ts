import { zod } from "../deps/common.ts";
import moduleValidators from "../modules/types.ts";

const serializedConfig = zod.object(
  {
    modules: zod.array(moduleValidators.moduleManifest),
    blackboard: moduleValidators.blackboard,
  },
);

export type SerializedConfig = zod.infer<typeof serializedConfig>;

export default {
  serializedConfig,
};
