import { Err, Ok, Result } from "../deps/cli.ts";
import logger from "../core/logger.ts";

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

export async function runAndReturn(
  cmd: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
  } = {},
): Promise<string> {
  const { cwd, env } = {
    ...options,
  };
  const output = await new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd,
    stdout: "piped",
    stderr: "piped",
    env,
  }).output();

  if (output.success) {
    return new TextDecoder().decode(output.stdout);
  }
  throw new ChildError(output.code, new TextDecoder().decode(output.stderr));
}

export async function spawn(
  cmd: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    pipeInput?: string;
  } = {},
) {
  const { cwd, env, pipeInput } = {
    ...options,
  };
  logger().debug("spawning", cmd);
  const child = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd,
    stdout: "piped",
    stderr: "piped",
    ...(pipeInput
      ? {
        stdin: "piped",
      }
      : {}),
    env,
  }).spawn();

  if (self.name) {
    child.stdout.pipeTo(
      new WritableStream({
        write(chunk) {
          console.log(new TextDecoder().decode(chunk));
        },
      }),
    );
    child.stderr.pipeTo(
      new WritableStream({
        write(chunk) {
          console.error(new TextDecoder().decode(chunk));
        },
      }),
    );
  } else {
    // keep pipe asynchronous till the command exists
    void child.stdout.pipeTo(Deno.stdout.writable, { preventClose: true });
    void child.stderr.pipeTo(Deno.stderr.writable, { preventClose: true });
  }

  if (pipeInput) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(pipeInput));
    writer.releaseLock();
    await child.stdin.close();
  }
  const { code, success } = await child.status;
  if (!success) {
    throw Error(`child failed with code ${code}`);
  }
}

function home_dir(): string | null {
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
  return { homeDir: home, shareDir: `${home}/.local/share/ghjk` };
}

export const AVAIL_CONCURRENCY = Number.parseInt(
  Deno.env.get("DENO_JOBS") ?? "1",
);

if (Number.isNaN(AVAIL_CONCURRENCY)) {
  throw Error(`Value of DENO_JOBS is NAN: ${Deno.env.get("DENO_JOBS")}`);
}
