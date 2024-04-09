//! this provides common exports for Port implementors

// NOTE: avoid importing anything that imports std_ports
// here to avoid circular dependencies with the std ports
// themselves

export * from "./modules/ports/mod.ts";
export * from "./utils/mod.ts";
export * from "./deps/ports.ts";
export { default as logger } from "./utils/logger.ts";
export { GithubReleasePort } from "./modules/ports/ghrel.ts";
export { PortBase } from "./modules/ports/base.ts";
export * from "./utils/unarchive.ts";
export { default as portsValidators } from "./modules/ports/types.ts";
export { serializePlatform } from "./modules/ports/types/platform.ts";

import { std_url } from "./deps/common.ts";
import { PortBase } from "./modules/ports/base.ts";
import type { ArchEnum, ListAllArgs, OsEnum } from "./modules/ports/types.ts";
import { serializePlatform } from "./modules/ports/types/platform.ts";

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
