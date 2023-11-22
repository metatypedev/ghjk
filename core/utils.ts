import logger from "./logger.ts";
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
  pipeOut?: WritableStream<Uint8Array>;
  pipeErr?: WritableStream<Uint8Array>;
};

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
    stdout: "piped",
    stderr: "piped",
    ...(pipeInput
      ? {
        stdin: "piped",
      }
      : {}),
    env,
  }).spawn();

  // keep pipe asynchronous till the command exists
  void child.stdout.pipeTo(options.pipeOut ?? Deno.stdout.writable, {
    preventClose: true,
  });
  void child.stderr.pipeTo(options.pipeErr ?? Deno.stderr.writable, {
    preventClose: true,
  });

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

export async function spawnOutput(
  cmd: string[],
  options: Omit<SpawnOptions, "pipeOut" | "pipeErr"> = {},
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
  throw new ChildError(
    output.code,
    new TextDecoder().decode(output.stdout) + "\n" +
      new TextDecoder().decode(output.stderr),
  );
}
