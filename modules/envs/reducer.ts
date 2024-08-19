import { unwrapZodRes } from "../../port.ts";
import { execTask } from "../tasks/exec.ts";
import { getTasksCtx } from "../tasks/inter.ts";
import type { GhjkCtx } from "../types.ts";
import type {
  EnvRecipeX,
  PosixDirProvisionType,
  Provision,
  ProvisionReducer,
  WellKnownEnvRecipeX,
  WellKnownProvision,
} from "./types.ts";
import {
  envVarDynTy,
  posixDirProvisionTypes,
  wellKnownProvisionTypes,
} from "./types.ts";
import validators from "./types.ts";

export type ProvisionReducerStore = Map<
  string,
  ProvisionReducer<Provision, Provision>
>;

/**
 * In order to provide a means for other modules to define their own
 * environment provisions, {@link ProvisionReducer}s can be registered
 * here.
 */
export function getProvisionReducerStore(
  gcx: GhjkCtx,
) {
  const id = "provisionReducerStore";
  let store = gcx.blackboard.get(id) as
    | ProvisionReducerStore
    | undefined;
  if (!store) {
    store = new Map();
    gcx.blackboard.set(id, store);
  }
  store?.set(
    envVarDynTy,
    installDynEnvReducer(gcx) as ProvisionReducer<Provision, Provision>,
  );
  for (const ty of posixDirProvisionTypes) {
    store?.set(
      ty + ".dynamic",
      installDynamicPathVarReducer(gcx, ty) as ProvisionReducer<
        Provision,
        Provision
      >,
    );
  }
  return store;
}

/**
 * Looks at each provision in the recipe and if it's not a type of
 * {@link WellKnownProvision}, looks for reducers in
 * {@link ProvisionReducer} to convert it to one.
 */
export async function reduceStrangeProvisions(
  gcx: GhjkCtx,
  env: EnvRecipeX,
) {
  const reducerStore = getProvisionReducerStore(gcx);
  // Replace by `Object.groupBy` once the types for it are fixed
  const bins = {} as Record<string, Provision[]>;
  for (const item of env.provides) {
    let bin = bins[item.ty];
    if (!bin) {
      bin = [];
      bins[item.ty] = bin;
    }
    bin.push(item);
  }
  const reducedSet = [] as WellKnownProvision[];
  for (const [ty, items] of Object.entries(bins)) {
    if (wellKnownProvisionTypes.includes(ty as any)) {
      reducedSet.push(
        ...items.map((item) => validators.wellKnownProvision.parse(item)),
      );
      continue;
    }
    const reducer = reducerStore.get(ty);
    if (!reducer) {
      throw new Error(`no provider reducer found for ty: ${ty}`, {
        cause: items,
      });
    }
    const reduced = await reducer(items);
    reducedSet.push(
      ...reduced.map((prov) =>
        unwrapZodRes(
          validators.wellKnownProvision.safeParse(prov),
          { prov },
          `error parsing reduced provision`,
        )
      ),
    );
  }
  const out: WellKnownEnvRecipeX = {
    ...env,
    provides: reducedSet,
  };
  return out;
}

export function installDynEnvReducer(gcx: GhjkCtx) {
  return async (provisions: Provision[]) => {
    const output = [];
    const badProvisions = [];
    const taskCtx = getTasksCtx(gcx);

    for (const provision of provisions) {
      const ty = "posix.envVar";
      const key = provision.taskKey as string;

      const taskGraph = taskCtx.taskGraph;
      const taskConf = taskCtx.config;

      const targetKey = Object.entries(taskConf.tasks)
        .filter(([_, task]) => task.key == key)
        .shift()?.[0];

      if (targetKey) {
        // console.log("key", key, " maps to target ", targetKey);
        const results = await execTask(gcx, taskConf, taskGraph, targetKey, []);
        output.push({ ...provision, ty, val: results[key] as any ?? "" });
      } else {
        badProvisions.push(provision);
      }
    }

    if (badProvisions.length >= 1) {
      throw new Error("cannot deduce task from keys", {
        cause: { badProvisions },
      });
    }
    return output;
  };
}

export function installDynamicPathVarReducer(
  gcx: GhjkCtx,
  ty: PosixDirProvisionType,
) {
  return async (provisions: Provision[]) => {
    const output = [];
    const badProvisions = [];
    const taskCtx = getTasksCtx(gcx);

    for (const provision of provisions) {
      const key = provision.taskKey as string;

      const taskGraph = taskCtx.taskGraph;
      const taskConf = taskCtx.config;

      const targetKey = Object.entries(taskConf.tasks)
        .find(([_, task]) => task.key === key)?.[0];

      if (targetKey) {
        const results = await execTask(gcx, taskConf, taskGraph, targetKey, []);
        output.push({ ...provision, ty, path: results[key] as string });
      } else {
        badProvisions.push(provision);
      }

      if (badProvisions.length >= 1) {
        throw new Error("cannot deduce task from keys", {
          cause: { badProvisions },
        });
      }

      return output;
    }
  };
}
