import type { GhjkCtx } from "../types.ts";
import type { PortsCtx } from "./mod.ts";
import type { InstallGraph } from "./sync.ts"; // TODO: rename to install.ts

export function getPortsCtx(
  gcx: GhjkCtx,
) {
  const id = "ctx.ports";
  let ctx = gcx.blackboard.get(id) as
    | PortsCtx
    | undefined;
  if (!ctx) {
    ctx = { config: { sets: {} } };
    gcx.blackboard.set(id, ctx);
  }
  return ctx;
}

/**
 * Get a user friendly description of an {@link InstallGraph}.
 */
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
