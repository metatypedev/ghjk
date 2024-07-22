//! Integration between Ports and Envs module

import { expandGlobsAndAbsolutize, unwrapZodRes } from "../../utils/mod.ts";
import { Provision } from "../envs/types.ts";
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
import validators, { installProvisionTy } from "./types.ts";

export function installSetReducer(gcx: GhjkCtx) {
  return async (provisions: InstallSetProvision[]) => {
    if (provisions.length > 1) {
      throw new Error(
        'only one "ghjkPorts" provision per environment is supported',
      );
    }
    const { set } = unwrapZodRes(
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
  const directReducer = installSetReducer(gcx);
  return (provisions: InstallSetRefProvision[]) =>
    directReducer(provisions.map(
      (prov) => {
        const { setId } = unwrapZodRes(
          validators.installSetRefProvision.safeParse(prov),
          {},
          "error parsing env provision",
        );
        const set = pcx.config.sets[setId];
        if (!set) {
          throw new Error(
            `provisioned install set under id "${setId}" not found`,
          );
        }
        return { ty: "ghjk.ports.InstallSet", set };
      },
    ));
}

async function reduceInstArts(
  installGraph: InstallGraph,
  installArts: Map<string, InstallArtifacts>,
) {
  const out = [] as Provision[];

  // use this to track seen env vars to report conflicts
  const foundEnvVars: Record<string, [string, string]> = {};
  // FIXME: detect shim conflicts
  // FIXME: better support for multi installs
  await Promise.all(installGraph.user.map(async (instId) => {
    const { binPaths, libPaths, includePaths, installPath, env } = installArts
      .get(
        instId,
      )!;
    out.push({ ty: installProvisionTy, instId });

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
        ty: "posix.envVar",
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
          ty: "posix.exec" as const,
          absolutePath,
        }))
      ),
      ...libPathsNorm.flatMap((paths) =>
        paths.map((absolutePath) => ({
          ty: "posix.sharedLib" as const,
          absolutePath,
        }))
      ),
      ...includePathsNorm.flatMap((paths) =>
        paths.map((absolutePath) => ({
          ty: "posix.headerFile" as const,
          absolutePath,
        }))
      ),
    );
  }));

  return out;
}
