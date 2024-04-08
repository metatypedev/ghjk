import type { GhjkCtx } from "../types.ts";
import type { InstallGraph } from "./sync.ts"; // TODO: rename to install.ts

export type InstallMeta = {
  instId: string;
  version: string;
  port: string;
};

export type InstallSetMeta = {
  userInstalls: InstallMeta[];
  buildInstalls: InstallMeta[];
};

export type InstallSetMetaStore = Map<string, InstallSetMeta>;

export function getInstallSetMetaStore(
  gcx: GhjkCtx,
) {
  const id = "installSetMetaStore";
  let memoStore = gcx.blackboard.get(id) as
    | InstallSetMetaStore
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
    return {
      port: inst.portRef,
      instId: inst.instId,
      version: inst.config.version,
    };
  }
  const userInstallIds = new Set(graph.user);
  const out: InstallSetMeta = {
    userInstalls: graph.user.map(installMetaFromGraph),
    buildInstalls: Object.keys(graph.all)
      .filter((key) => !userInstallIds.has(key))
      .map(installMetaFromGraph),
  };
  return out;
}
