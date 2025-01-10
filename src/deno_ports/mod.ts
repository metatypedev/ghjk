//! this provides common exports and general support for denoFile port
//! implementors

// NOTE: avoid importing anything that imports std_ports
// here to avoid circular dependencies with the std ports
// themselves

export * from "../sys_deno/ports/mod.ts";
export * from "../deno_utils/mod.ts";
export * from "./unar/deps.ts";
export { default as logger } from "../deno_utils/logger.ts";
export { GithubReleasePort } from "../sys_deno/ports/ghrel.ts";
export { PortBase } from "../sys_deno/ports/base.ts";
export * from "./unar/mod.ts";
export { default as portsValidators } from "../sys_deno/ports/types.ts";
export { serializePlatform } from "../sys_deno/ports/types/platform.ts";

import { $ } from "../deno_utils/mod.ts";
import { std_url } from "../deps.ts";
import { PortBase } from "../sys_deno/ports/base.ts";
import type {
  ArchEnum,
  DepArts,
  ListAllArgs,
  OsEnum,
  PortDep,
} from "../sys_deno/ports/types.ts";
import { serializePlatform } from "../sys_deno/ports/types/platform.ts";

export function dwnUrlOut(url: string) {
  return { url, name: std_url.basename(url) };
}

export function osXarch<O extends OsEnum, A extends ArchEnum>(
  supportedOses: O[],
  supportedArches: A[],
) {
  return supportedOses.flatMap((os) =>
    supportedArches.map((arch) => serializePlatform({ os, arch }))
  );
}

export async function defaultLatestStable(
  impl: PortBase,
  args: ListAllArgs,
) {
  const allVers = await impl.listAll(args);
  if (allVers.length == 0) {
    throw new Error("no latest stable versions found");
  }
  return allVers[allVers.length - 1];
}

export function depExecShimPath(
  dep: PortDep,
  execName: string,
  depArts: DepArts,
) {
  const path = tryDepExecShimPath(dep, execName, depArts);
  if (!path) {
    throw new Error(
      `unable to find shim path for bin "${execName}" of dep ${dep.name}`,
    );
  }
  return path;
}

export function depEnv(
  dep: PortDep,
  depArts: DepArts,
) {
  return depArts[dep.name]?.env ?? {};
}

export function tryDepExecShimPath(
  dep: PortDep,
  execName: string,
  depArts: DepArts,
) {
  const shimPaths = depArts[dep.name];
  if (!shimPaths) {
    return;
  }
  // FIXME: match despite `.exe` extension on windows
  const path = shimPaths.execs[execName];
  if (!path) {
    return;
  }
  return path;
}

export function pathsWithDepArts(
  depArts: DepArts,
  os: OsEnum,
) {
  const pathSet = new Set();
  const libSet = new Set();
  const includesSet = new Set();
  for (const [_, { execs, libs, includes }] of Object.entries(depArts)) {
    for (const [_, binPath] of Object.entries(execs)) {
      pathSet.add($.path(binPath).parentOrThrow());
    }
    for (const [_, libPath] of Object.entries(libs)) {
      libSet.add($.path(libPath).parentOrThrow());
    }
    for (const [_, incPath] of Object.entries(includes)) {
      includesSet.add($.path(incPath).parentOrThrow());
    }
  }

  let LD_LIBRARY_ENV: string;
  switch (os) {
    case "darwin":
      LD_LIBRARY_ENV = "DYLD_LIBRARY_PATH";
      break;
    case "linux":
      LD_LIBRARY_ENV = "LD_LIBRARY_PATH";
      break;
    default:
      throw new Error(`unsupported os ${os}`);
  }
  return {
    PATH: `${[...pathSet.keys()].join(":")}:${Deno.env.get("PATH") ?? ""}`,
    LIBRARY_PATH: `${[...libSet.keys()].join(":")}:${
      Deno.env.get("LIBRARY_PATH") ?? ""
    }`,
    C_INCLUDE_PATH: `${[...includesSet.keys()].join(":")}:${
      Deno.env.get("C_INCLUDE_PATH") ?? ""
    }`,
    CPLUS_INCLUDE_PATH: `${[...includesSet.keys()].join(":")}:${
      Deno.env.get("CPLUS_INCLUDE_PATH") ?? ""
    }`,
    [LD_LIBRARY_ENV]: `${[...libSet.keys()].join(":")}:${
      Deno.env.get(LD_LIBRARY_ENV) ?? ""
    }`,
  };
}
