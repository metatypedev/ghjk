import type { GhjkCtx } from "../types.ts";
import type { Provision, ProvisionReducer } from "./types.ts";

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
