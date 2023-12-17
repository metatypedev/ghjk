import { dax, jsonHash, std_fs, std_path } from "../deps/common.ts";
import logger, { isColorfulTty } from "./logger.ts";
import type {
  DepShims,
  InstallConfigLite,
  PortDep,
} from "../modules/ports/types.ts";

export function dbg<T>(val: T) {
  logger().debug("inline", val);
  return val;
}

export function pathWithDepShims(
  depShims: DepShims,
) {
  const set = new Set();
  for (const [_, bins] of Object.entries(depShims)) {
    for (const [_, binPath] of Object.entries(bins)) {
      set.add(std_path.dirname(binPath));
    }
  }
  return `${[...set.keys()].join(":")}:${Deno.env.get("PATH")}`;
}

export function depBinShimPath(
  dep: PortDep,
  binName: string,
  depShims: DepShims,
) {
  const shimPaths = depShims[dep.id];
  if (!shimPaths) {
    throw new Error(`unable to find shims for dep ${dep.id}`);
  }
  const path = shimPaths[binName];
  if (!path) {
    throw new Error(
      `unable to find shim path for bin "${binName}" of dep ${dep.id}`,
    );
  }
  return path;
}

// Lifted from https://deno.land/x/hextools@v1.0.0
// MIT License
// Copyright (c) 2020 Santiago Aguilar Hernández
export function bufferToHex(buffer: ArrayBuffer): string {
  return Array.prototype.map.call(
    new Uint8Array(buffer),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function getInstallHash(install: InstallConfigLite) {
  const hashBuf = await jsonHash.digest("SHA-256", install as jsonHash.Tree);
  const hashHex = bufferToHex(hashBuf).slice(0, 8);
  return `${install.portId}@${hashHex}`;
}

export const $ = dax.build$(
  {
    commandBuilder: (() => {
      const builder = new dax.CommandBuilder().printCommand(true);
      builder.setPrintCommandLogger((...args) =>
        logger().debug("spawning", args.splice(1))
      );
      return builder;
    })(),
    extras: {
      inspect(val: unknown) {
        return Deno.inspect(val, { colors: isColorfulTty() });
      },
      pathToString(path: dax.PathRef) {
        return path.toString();
      },
    },
  },
);

export function inWorker() {
  return typeof WorkerGlobalScope !== "undefined" &&
    self instanceof WorkerGlobalScope;
}

export async function findConfig(path: string) {
  let current = path;
  while (current !== "/") {
    const location = `${path}/ghjk.ts`;
    if (await std_fs.exists(location)) {
      return location;
    }
    current = std_path.dirname(current);
  }
  return null;
}

export function envDirFromConfig(ghjkDir: string, configPath: string) {
  return std_path.resolve(
    ghjkDir,
    "envs",
    std_path.dirname(configPath).replaceAll("/", "."),
  );
}

export function home_dir(): string | null {
  switch (Deno.build.os) {
    case "linux":
    case "darwin":
      return Deno.env.get("HOME") ?? null;
    case "windows":
      return Deno.env.get("USERPROFILE") ?? null;
    default:
      return null;
  }
}

export function dirs() {
  const home = home_dir();
  if (!home) {
    throw new Error("cannot find home dir");
  }
  return {
    homeDir: home,
    shareDir: std_path.resolve(home, ".local", "share"),
  };
}

export const AVAIL_CONCURRENCY = Number.parseInt(
  Deno.env.get("DENO_JOBS") ?? "1",
);

if (Number.isNaN(AVAIL_CONCURRENCY)) {
  throw new Error(`Value of DENO_JOBS is NAN: ${Deno.env.get("DENO_JOBS")}`);
}

export async function importRaw(spec: string) {
  const url = new URL(spec);
  if (url.protocol == "file:") {
    return await Deno.readTextFile(url.pathname);
  }
  if (url.protocol.match(/^http/)) {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(
        `error importing raw using fetch from ${spec}: ${resp.status} - ${resp.statusText}`,
      );
    }
    return await resp.text();
  }
  throw new Error(
    `error importing raw from ${spec}: unrecognized protocol ${url.protocol}`,
  );
}
