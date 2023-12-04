import { dax, std_path } from "../deps/common.ts";
import logger from "./logger.ts";
import type {
  DepShims,
  InstallConfig,
  PortDep,
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

export function getInstallId(install: InstallConfig) {
  if ("pluginRepo" in install) {
    const url = new URL(install.pluginRepo);
    const pluginId = `${url.hostname}-${url.pathname.replaceAll("/", ".")}`;
    return `asdf-${pluginId}`;
  }
  return install.portName;
}

export const $ = dax.build$(
  {},
);
$.setPrintCommand(true);

export function inWorker() {
  return typeof WorkerGlobalScope !== "undefined" &&
    self instanceof WorkerGlobalScope;
}

let colorEnvFlagSet = false;
Deno.permissions.query({
  name: "env",
  variable: "CLICOLOR_FORCE",
}).then((perm) => {
  if (perm.state == "granted") {
    const val = Deno.env.get("CLICOLOR_FORCE");
    colorEnvFlagSet = !!val && val != "0" && val != "false";
  }
});

export function isColorfulTty(outFile = Deno.stdout) {
  if (colorEnvFlagSet) {
    return true;
  }
  if (Deno.isatty(outFile.rid)) {
    const { columns } = Deno.consoleSize();
    return columns > 0;
  }
  return false;
}
