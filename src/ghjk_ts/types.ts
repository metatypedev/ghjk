import { zod } from "../deps.ts";
import moduleValidators from "../sys_deno/types.ts";

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
