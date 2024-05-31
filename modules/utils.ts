import { EnvsCtx } from "./envs/mod.ts";
import { PortsCtx } from "./ports/mod.ts";
import {
  InstallSetRefProvision,
  installSetRefProvisionTy,
} from "./ports/types.ts";
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
  let envsCtx = gcx.blackboard.get(envsCtxBlackboardKey) as
    | EnvsCtx
    | undefined;

  if (!envsCtx) {
    envsCtx = {
      activeEnv: "",
      config: {
        defaultEnv: "",
        envs: {},
      },
    };
    gcx.blackboard.set(envsCtxBlackboardKey, envsCtx);
  }

  return envsCtx;
}

export function getPortsCtx(
  gcx: GhjkCtx,
): PortsCtx {
  let portsCtx = gcx.blackboard.get(portsCtxBlackboardKey) as
    | PortsCtx
    | undefined;

  if (!portsCtx) {
    portsCtx = {
      config: {
        sets: {},
      },
    };
    gcx.blackboard.set(portsCtxBlackboardKey, portsCtx);
  }

  return portsCtx;
}

export function getTasksCtx(
  gcx: GhjkCtx,
): TasksCtx {
  let tasksCtx = gcx.blackboard.get(tasksCtxBlackboardKey) as
    | TasksCtx
    | undefined;

  if (!tasksCtx) {
    tasksCtx = {
      config: {
        envs: {},
        tasks: {},
        tasksNamed: [],
      },
      taskGraph: {
        indie: [],
        revDepEdges: {},
        depEdges: {},
      },
    };
    gcx.blackboard.set(tasksCtxBlackboardKey, tasksCtx);
  }

  return tasksCtx;
}

export function getActiveEnvInstallSetId(envsCtx: EnvsCtx): string {
  const activeEnvName = envsCtx.activeEnv;
  const activeEnv = envsCtx.config.envs[activeEnvName];
  if (!activeEnv) {
    throw new Error(`No env found under given name "${activeEnvName}"`);
  }

  const instSetRef = activeEnv.provides.filter((prov) =>
    prov.ty === installSetRefProvisionTy
  )[0] as InstallSetRefProvision;

  return instSetRef.setId;
}
