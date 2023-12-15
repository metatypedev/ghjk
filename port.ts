//! this provides common exports for Port implementors

// NOTE: avoid importing anything that imports std_ports
// here to avoid circular dependencies with the std ports
// themselves

export * from "./modules/ports/mod.ts";
export * from "./utils/mod.ts";
export * from "./deps/ports.ts";
export { default as logger } from "./utils/logger.ts";
export * as asdf from "./modules/ports/asdf.ts";
export { GithubReleasePort } from "./modules/ports/ghrel.ts";
export { PortBase } from "./modules/ports/base.ts";
export * from "./utils/unarchive.ts";

import { std_url } from "./deps/common.ts";
import type { ArchEnum, OsEnum } from "./modules/ports/types.ts";

export function dwnUrlOut(url: string) {
  return { url, name: std_url.basename(url) };
}

export function osXarch(supportedOses: OsEnum[], supportedArches: ArchEnum[]) {
  return supportedOses.flatMap((os) =>
    supportedArches.map((arch) => ({
      os,
      arch,
    }))
  );
}
