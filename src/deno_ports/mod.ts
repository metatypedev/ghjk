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

import { std_url } from "../deps.ts";
import { PortBase } from "../sys_deno/ports/base.ts";
import type { ArchEnum, ListAllArgs, OsEnum } from "../sys_deno/ports/types.ts";
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
