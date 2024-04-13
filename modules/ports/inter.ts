import type { GhjkCtx } from "../types.ts";
import type { InstallSetX } from "./types.ts";
import type { InstallGraph } from "./sync.ts"; // TODO: rename to install.ts

export type InstallSetStore = Map<string, InstallSetX>;

export function getInstallSetStore(
  gcx: GhjkCtx,
) {
  const id = "installSetStore";
  let memoStore = gcx.blackboard.get(id) as
    | InstallSetStore
    | undefined;
  if (!memoStore) {
    memoStore = new Map();
    gcx.blackboard.set(id, memoStore);
  }
  return memoStore;
}

export function installGraphToSetMeta(graph: InstallGraph) {
  function installMetaFromGraph(id: string) {
    const inst = graph.all[id]!;
    const {
      buildDepConfigs: _bDeps,
      resolutionDepConfigs: _rDeps,
      ...confWithoutDeps
    } = inst.config;
    return {
      instId: inst.instId,
      ...confWithoutDeps,
    };
  }
  const userInstallIds = new Set(graph.user);
  const out = {
    userInstalls: graph.user.map(installMetaFromGraph),
    buildInstalls: Object.keys(graph.all)
      .filter((key) => !userInstallIds.has(key))
      .map(installMetaFromGraph),
  };
  return out;
}
