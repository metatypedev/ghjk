import { unwrapParseRes } from "../../port.ts";
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

export type ProvisionReducerStore = Map<string, ProvisionReducer<Provision>>;
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
  return store;
}

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
        unwrapParseRes(
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
