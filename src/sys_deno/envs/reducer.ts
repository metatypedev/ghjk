import { promiseCollector, unwrapZodRes } from "../../deno_utils/mod.ts";
import type { GhjkCtx } from "../types.ts";
import type { EnvRecipe, Provision, ProvisionReducer } from "./types.ts";
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
  env: EnvRecipe,
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
  // only reduce what one can here
  // the rust side will reduce the rest
  // and throw an error if there's a strange
  // one left at the end
  const reducedSet = [] as Provision[];
  const promises = promiseCollector();
  for (const [ty, items] of Object.entries(bins)) {
    if ((wellKnownProvisionTypes as readonly string[]).includes(ty)) {
      reducedSet.push(
        ...items.map((item) => validators.wellKnownProvision.parse(item)),
      );
      continue;
    }
    const reducer = reducerStore.get(ty);
    if (!reducer) {
      reducedSet.push(...items);
    } else {
      promises.push(async () => {
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
      });
    }
  }
  await promises.finish();
  const out: EnvRecipe = {
    ...env,
    provides: reducedSet,
  };
  return out;
}
