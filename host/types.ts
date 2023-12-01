import { zod } from "../deps/common.ts";
import moduleValidators from "../modules/types.ts";

const serializedConfig = zod.object(
  {
    modules: zod.array(moduleValidators.module),
  },
);

export type SerializedConfig = zod.infer<typeof serializedConfig>;

export default {
  serializedConfig,
};
