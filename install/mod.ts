//! this installs the different shell ghjk hooks in ~/.local/share/ghjk
//! and a `ghjk` bin at ~/.local/share/bin

// TODO: support for different environments to use different versions of ghjk

import logger from "../utils/logger.ts";
import { std_fs, std_path } from "../deps/cli.ts";
import { $, dirs, importRaw } from "../utils/mod.ts";

// null means it should be removed (for cleaning up old versions)
const getHooksVfs = async () => ({
  "bash-preexec.sh": await importRaw(
    "https://raw.githubusercontent.com/rcaloras/bash-preexec/0.5.0/bash-preexec.sh",
  ),

  ".zshenv": (
    await importRaw(import.meta.resolve("./hooks/zsh.zsh"))
  ),

  // the hook run before every prompt draw in bash
  "env.sh": (
    await importRaw(import.meta.resolve("./hooks/bash.sh"))
  ),

  "env.fish": (
    await importRaw(import.meta.resolve("./hooks/fish.fish"))
  ),
});

export async function detectShell(): Promise<string> {
  let path = Deno.env.get("SHELL");
  if (!path) {
    try {
      path = await $`ps -p ${Deno.ppid} -o comm=`.text();
    } catch (err) {
      throw new Error(`cannot get parent process name: ${err}`);
    }
  }
  return std_path.basename(path, ".exe").toLowerCase().trim();
}

async function unpackVFS(
  vfs: Record<string, string>,
  baseDir: string,
  replacements: [RegExp, string][],
): Promise<void> {
  await $.path(baseDir).ensureDir();

  for (const [subpath, content] of Object.entries(vfs)) {
    const path = std_path.resolve(baseDir, subpath);
    if (content === null) {
      await $.path(baseDir).remove({ recursive: true });
    } else {
      let text = content.trim();
      for (const [re, repl] of replacements) {
        text = text.replace(re, repl);
      }
      await $.path(std_path.dirname(path)).ensureDir();
      await $.path(path).writeText(text);
    }
  }
}

async function filterAddFile(
  path: string,
  marker: RegExp,
  content: string | null,
) {
  const file = await Deno.readTextFile(path).catch(async (err) => {
    if (err instanceof Deno.errors.NotFound) {
      await Deno.mkdir(std_path.dirname(path), { recursive: true });
      return "";
    }
    throw err;
  });
  const lines = file.split("\n");

  let i = 0;
  while (i < lines.length) {
    if (marker.test(lines[i])) {
      lines.splice(i, 1);
    } else {
      i += 1;
    }
  }

  if (content !== null) {
    lines.push(content);
  }

  await Deno.writeTextFile(path, lines.join("\n"));
}

export interface InstallArgs {
  homeDir: string;
  ghjkDir: string;
  shellsToHook: string[];
  /// The mark used when adding the hook to the user's shell rcs
  /// Override t
  shellHookMarker: string;
  /// The ghjk bin is optional, one can always invoke it
  /// using `deno run --flags uri/to/ghjk/main.ts`;
  skipExecInstall: boolean;
  /// The directory in which to install the ghjk exec
  /// Preferrably, one that's in PATH
  ghjkExecInstallDir: string;
  /// the deno exec to be used by the ghjk executable
  /// by default will be "deno" i.e. whatever the shell resolves that to
  ghjkExecDenoExec: string;
  // Disable using a lockfile for the ghjk command
  noLockfile: boolean;
}

export const defaultInstallArgs: InstallArgs = {
  ghjkDir: std_path.resolve(dirs().shareDir, "ghjk"),
  homeDir: dirs().homeDir,
  shellsToHook: [],
  shellHookMarker: "ghjk-hook-default",
  skipExecInstall: true,
  // TODO: respect xdg dirs
  ghjkExecInstallDir: std_path.resolve(dirs().homeDir, ".local", "bin"),
  ghjkExecDenoExec: "deno",
  noLockfile: false,
};
export async function install(
  args: InstallArgs = defaultInstallArgs,
) {
  logger().debug("installing", args);
  if (Deno.build.os == "windows") {
    throw new Error("windows is not yet supported :/");
  }
  const ghjkDir = std_path.resolve(
    Deno.cwd(),
    std_path.normalize(args.ghjkDir),
  );
  // const hookVfs = ;
  logger().debug("unpacking vfs", { ghjkDir });
  await unpackVFS(
    await getHooksVfs(),
    ghjkDir,
    [[/__GHJK_DIR__/g, ghjkDir]],
  );
  for (const shell of args.shellsToHook) {
    const { homeDir } = args;
    if (shell === "fish") {
      const rcPath = std_path.resolve(homeDir, ".config/fish/config.fish");
      logger().debug("installing hook", {
        ghjkDir,
        shell,
        marker: args.shellHookMarker,
        rcPath,
      });
      await filterAddFile(
        rcPath,
        new RegExp(args.shellHookMarker, "g"),
        `. ${ghjkDir}/env.fish # ${args.shellHookMarker}`,
      );
    } else if (shell === "bash") {
      const rcPath = std_path.resolve(homeDir, ".bashrc");
      logger().debug("installing hook", {
        ghjkDir,
        shell,
        marker: args.shellHookMarker,
        rcPath,
      });
      await filterAddFile(
        rcPath,
        new RegExp(args.shellHookMarker, "g"),
        `. ${ghjkDir}/env.sh # ${args.shellHookMarker}`,
      );
    } else if (shell === "zsh") {
      const rcPath = std_path.resolve(homeDir, ".zshrc");
      logger().debug("installing hook", {
        ghjkDir,
        shell,
        marker: args.shellHookMarker,
        rcPath,
      });
      await filterAddFile(
        rcPath,
        new RegExp(args.shellHookMarker, "g"),
        // NOTE: we use the posix hook for zsh as well
        `. ${ghjkDir}/env.sh # ${args.shellHookMarker}`,
      );
    } else {
      throw new Error(`unsupported shell: ${shell}`);
    }
  }
  if (!args.skipExecInstall) {
    switch (Deno.build.os) {
      case "linux":
      case "freebsd":
      case "solaris":
      case "illumos":
      case "darwin": {
        await std_fs.ensureDir(args.ghjkExecInstallDir);
        const exePath = std_path.resolve(args.ghjkExecInstallDir, `ghjk`);
        logger().debug("installing executable", { exePath });
        const lockFlag = args.noLockfile
          ? "--no-lock"
          : `--lock $GHJK_DIR/deno.lock`;
        await Deno.writeTextFile(
          exePath,
          `#!/bin/sh 
GHJK_DIR="$\{GHJK_DIR:-${ghjkDir}}"
${args.ghjkExecDenoExec} run --unstable-worker-options -A ${lockFlag} ${
            import.meta.resolve("../main.ts")
          } $*`,
          { mode: 0o700 },
        );
        break;
      }
      default:
        throw new Error(`${Deno.build.os} is not yet supported`);
    }
  }
  logger().info("install success");
}
