import type { GhjkCtx } from "../types.ts";
import type { EnvsCtx } from "./mod.ts";

export function getEnvsCtx(
  gcx: GhjkCtx,
): EnvsCtx {
  const key = "ctx.envs";
  let ctx = gcx.blackboard.get(key) as
    | EnvsCtx
    | undefined;

  if (!ctx) {
    ctx = {
      activeEnv: "",
      config: {
        defaultEnv: "",
        envs: {},
        envsNamed: [],
      },
    };
    gcx.blackboard.set(key, ctx);
  }

  return ctx;
}
