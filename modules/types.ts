import { zod } from "../deps/common.ts";

const module = zod.object({
  id: zod.string(),
});

export type Module = zod.infer<typeof module>;

export default {
  module,
};
