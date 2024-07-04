import { globalBlackboard } from "../../files/mod.ts";
import { unwrapZodRes } from "../../port.ts";
// import { execTask } from "../tasks/exec.ts";
import type { GhjkCtx } from "../types.ts";
import type {
  EnvRecipeX,
  Provision,
  ProvisionReducer,
  WellKnownEnvRecipeX,
  WellKnownProvision,
} from "./types.ts";
import { wellKnownProvisionTypes } from "./types.ts";
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
    store.set("posix.envVarDyn", getEnvReducer(gcx));
    gcx.blackboard.set(id, store);
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

function getEnvReducer(_gcx: GhjkCtx) {
  // TODO:
  // How to exec task from here? how to look for envs.#task?
  // execTask(gcx, tasksConfig, taskGraph, targetKey, args)
  // await execTask(gcx, {...??}, {}, "", "");
  // console.log(globalBlackboard);
  // console.log(gcx);

  return (provisions: Provision[]) => {
    return Promise.resolve(provisions.map((p) => {
      const ty = "posix.envVar";
      let val = p.val;
      const dynEval = globalBlackboard.get(`fn.${p.val}`) as CallableFunction;
      if (dynEval) {
        val = dynEval();
      }
      // if (isInWorkerContext()) {
      //   console.log("reducer within a WORKER?");
      // }

      return { ...p, ty: ty, val };
    }));
  };
}
