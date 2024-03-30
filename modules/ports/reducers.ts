//! Integration between Ports and Envs module

import { expandGlobsAndAbsolutize, unwrapParseRes } from "../../utils/mod.ts";
import type { WellKnownProvision } from "../envs/types.ts";
import { GhjkCtx } from "../types.ts";
// NOTE: mod.ts must always be a type import
import type { PortsCtx } from "./mod.ts";
import {
  buildInstallGraph,
  installFromGraph,
  type InstallGraph,
  syncCtxFromGhjk,
} from "./sync.ts";
import type {
  InstallArtifacts,
  InstallSetProvision,
  InstallSetRefProvision,
} from "./types.ts";
import validators from "./types.ts";

export function installSetReducer(gcx: GhjkCtx) {
  return async (provisions: InstallSetProvision[]) => {
    if (provisions.length > 1) {
      throw new Error(
        'only one "ghjkPorts" provision per environment is supported',
      );
    }
    const { set } = unwrapParseRes(
      validators.installSetProvision.safeParse(provisions[0]),
      {},
      "error parsing env provision",
    );
    await using scx = await syncCtxFromGhjk(gcx);
    const installGraph = await buildInstallGraph(scx, set);
    const installArts = await installFromGraph(scx, installGraph);

    const out = await reduceInstArts(installGraph, installArts);
    return out;
  };
}

export function installSetRefReducer(gcx: GhjkCtx, pcx: PortsCtx) {
  return async (provisions: InstallSetRefProvision[]) => {
    if (provisions.length > 1) {
      throw new Error(
        'only one "ghjkPorts" provision per environment is supported',
      );
    }
    const { setId } = unwrapParseRes(
      validators.installSetRefProvision.safeParse(provisions[0]),
      {},
      "error parsing env provision",
    );
    const installGraph = pcx.installGraphs.get(setId);
    if (!installGraph) {
      throw new Error(
        `provisioned install set under id "${setId}" not found`,
      );
    }
    await using scx = await syncCtxFromGhjk(gcx);
    const installArts = await installFromGraph(scx, installGraph);

    const out = await reduceInstArts(installGraph, installArts);
    return out;
  };
}

async function reduceInstArts(
  installGraph: InstallGraph,
  installArts: Map<string, InstallArtifacts>,
) {
  const out: WellKnownProvision[] = [];

  // use this to track seen env vars to report conflicts
  const foundEnvVars: Record<string, [string, string]> = {};
  // FIXME: detect shim conflicts
  // FIXME: better support for multi installs
  await Promise.all(installGraph.user.map(async (instId) => {
    const { binPaths, libPaths, includePaths, installPath, env } = installArts
      .get(
        instId,
      )!;

    for (const [key, val] of Object.entries(env)) {
      const conflict = foundEnvVars[key];
      if (conflict) {
        throw new Error(
          `duplicate env var found ${key} from sources ${instId} & ${
            conflict[1]
          }`,
          {
            cause: {
              a: [instId, val],
              b: conflict,
            },
          },
        );
      }
      foundEnvVars[key] = [val, instId];
      out.push({
        ty: "envVar",
        key,
        val,
      });
    }
    const expandCurry = (path: string) =>
      expandGlobsAndAbsolutize(path, installPath);

    const [binPathsNorm, libPathsNorm, includePathsNorm] = await Promise
      .all(
        [
          Promise.all(binPaths.map(expandCurry)),
          Promise.all(libPaths.map(expandCurry)),
          Promise.all(includePaths.map(expandCurry)),
        ],
      );
    out.push(
      ...binPathsNorm.flatMap((paths) =>
        paths.map((absolutePath) => ({
          ty: "posixExec" as const,
          absolutePath,
        }))
      ),
      ...libPathsNorm.flatMap((paths) =>
        paths.map((absolutePath) => ({
          ty: "posixSharedLib" as const,
          absolutePath,
        }))
      ),
      ...includePathsNorm.flatMap((paths) =>
        paths.map((absolutePath) => ({
          ty: "headerFile" as const,
          absolutePath,
        }))
      ),
    );
  }));

  return out;
}
