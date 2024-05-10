import { EnvsCtx } from "./envs/mod.ts";
import { PortsCtx } from "./ports/mod.ts";
import { TasksCtx } from "./tasks/mod.ts";
import {
  envsCtxBlackboardKey,
  GhjkCtx,
  portsCtxBlackboardKey,
  tasksCtxBlackboardKey,
} from "./types.ts";

export function getEnvsCtx(
  gcx: GhjkCtx,
): EnvsCtx {
  const envsCtx = gcx.blackboard.get(envsCtxBlackboardKey) as
    | EnvsCtx
    | undefined;

  if (!envsCtx) {
    throw new Error(
      "Could not resolve Env Context",
      {
        cause: {
          gcx,
        },
      },
    );
  }

  return envsCtx;
}

export function getPortsCtx(
  gcx: GhjkCtx,
): PortsCtx {
  const portsCtx = gcx.blackboard.get(portsCtxBlackboardKey) as
    | PortsCtx
    | undefined;

  if (!portsCtx) {
    throw new Error(
      "Could not resolve Ports Context",
      {
        cause: {
          gcx,
        },
      },
    );
  }

  return portsCtx;
}

export function getTasksCtx(
  gcx: GhjkCtx,
): TasksCtx {
  const tasksCtx = gcx.blackboard.get(tasksCtxBlackboardKey) as
    | TasksCtx
    | undefined;

  if (!tasksCtx) {
    throw new Error(
      "Could not resolve Tasks Context",
      {
        cause: {
          gcx,
        },
      },
    );
  }

  return tasksCtx;
}
