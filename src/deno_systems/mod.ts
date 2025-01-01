import { map } from "../../modules/std.ts";
import type { DenoSystemsRoot } from "./types.ts";

export default {
  systems: Object.fromEntries(
    Object.entries(map).map(
      ([id, sys]) => [id, (gcx) => new sys.ctor(gcx)],
    ),
  ),
} satisfies DenoSystemsRoot;
