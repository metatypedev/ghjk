import type { GhjkCtx } from "../types.ts";
import type { TasksCtx } from "./mod.ts";

export function getTasksCtx(
  gcx: GhjkCtx,
): TasksCtx {
  const key = "ctx.tasks";
  let ctx = gcx.blackboard.get(key) as
    | TasksCtx
    | undefined;

  if (!ctx) {
    ctx = {
      config: { tasks: {}, tasksNamed: [] },
      taskGraph: {
        indie: [],
        depEdges: {},
        revDepEdges: {},
      },
    };
    gcx.blackboard.set(key, ctx);
  }

  return ctx;
}
