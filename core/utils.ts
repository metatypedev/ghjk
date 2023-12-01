import { dax, std_path } from "../deps/common.ts";
import logger from "./logger.ts";
import type {
  AsdfInstallConfig,
  DepShims,
  InstallConfig,
  PlugDep,
} from "../modules/ports/types.ts";
export function dbg<T>(val: T) {
  logger().debug("inline", val);
  return val;
}

export class ChildError extends Error {
  constructor(
    public code: number,
    public output: string,
  ) {
    super(`ChildError - ${code} - ${output}`);
  }
}

export type SpawnOptions = {
  cwd?: string;
  env?: Record<string, string>;
  pipeInput?: string;
  // pipeOut?: WritableStream<Uint8Array>;
  // pipeErr?: WritableStream<Uint8Array>;
};

// FIXME: replace with deidcated ergonomic library
export async function spawn(
  cmd: string[],
  options: SpawnOptions = {},
) {
  const { cwd, env, pipeInput } = {
    ...options,
  };
  logger().debug("spawning", cmd);
  const child = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd,
    ...(pipeInput
      ? {
        stdin: "piped",
      }
      : {}),
    env,
  }).spawn();

  if (pipeInput) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(pipeInput));
    writer.releaseLock();
    await child.stdin.close();
  }
  const { code, success } = await child.status;
  if (!success) {
    throw new Error(`child failed with code ${code}`);
  }
}

export async function spawnOutput(
  cmd: string[],
  options: Omit<SpawnOptions, "pipeOut" | "pipeErr" | "pipeInput"> = {},
): Promise<string> {
  const { cwd, env } = {
    ...options,
  };
  logger().debug("spawning", cmd);
  const child = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd,
    stdout: "piped",
    stderr: "piped",
    env,
  }).spawn();

  const { code, success, stdout, stderr } = await child.output();
  if (!success) {
    throw new Error(
      `child failed with code ${code} - ${new TextDecoder().decode(stderr)}`,
    );
  }
  return new TextDecoder().decode(stdout);
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
  dep: PlugDep,
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

export function getInstallId(install: InstallConfig | AsdfInstallConfig) {
  if ("plugRepo" in install) {
    const url = new URL(install.plugRepo);
    const pluginId = `${url.hostname}-${url.pathname.replaceAll("/", ".")}`;
    return `asdf-${pluginId}`;
  }
  return install.plugName;
}

export const $ = dax.build$(
  {},
);
$.setPrintCommand(true);
