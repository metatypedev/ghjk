import { Err, Ok, Result } from "../deps/cli.ts";

export function dbg<T>(val: T) {
  console.log("[dbg] ", val);
  return val;
}

export async function runAndReturn(
  cmd: string[],
  cwd?: string,
  env: Record<string, string> = Deno.env.toObject(),
): Promise<Result<string, string>> {
  try {
    const output = await new Deno.Command(cmd[0], {
      args: cmd.slice(1),
      cwd,
      stdout: "piped",
      stderr: "piped",
      env,
    }).output();

    return output.success
      ? Ok(new TextDecoder().decode(output.stdout))
      : Err(new TextDecoder().decode(output.stderr));
  } catch (err) {
    return Err(err.toString());
  }
}

export async function runOrExit(
  cmd: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    pipeInput?: string;
  } = {},
) {
  const { cwd, env, pipeInput } = {
    ...options,
    env: options.env ?? Deno.env.toObject(),
  };
  console.log(cmd);
  const p = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd,
    stdout: "piped",
    stderr: "piped",
    stdin: "piped",
    env,
  }).spawn();

  // keep pipe asynchronous till the command exists
  void p.stdout.pipeTo(Deno.stdout.writable, { preventClose: true });
  void p.stderr.pipeTo(Deno.stderr.writable, { preventClose: true });

  if (pipeInput) {
    const writer = p.stdin.getWriter();
    await writer.write(new TextEncoder().encode(pipeInput));
    writer.releaseLock();
  }
  await p.stdin.close();
  const { code, success } = await p.status;
  if (!success) {
    Deno.exit(code);
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
