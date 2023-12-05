//! this installs the different shell ghjk hooks in ~/.local/share/ghjk
//! and a `ghjk` bin at ~/.local/share/bin

// TODO: support for different environments to use different versions of ghjk

import "../setup_logger.ts";
import logger from "../utils/logger.ts";
import { std_fs, std_path } from "../deps/cli.ts";
import { dirs, importRaw } from "../utils/mod.ts";
import { spawnOutput } from "../utils/mod.ts";

// null means it should be removed (for cleaning up old versions)
const hookVfs = {
  "hooks/bash-preexec.sh": await importRaw(
    "https://raw.githubusercontent.com/rcaloras/bash-preexec/0.5.0/bash-preexec.sh",
  ),

  "hooks/.zshenv": (
    await importRaw(import.meta.resolve("./hooks/zsh.zsh"))
  ),

  // the hook run before every prompt draw in bash
  "hooks/hook.sh": (
    await importRaw(import.meta.resolve("./hooks/bash.sh"))
  ),

  "hooks/hook.fish": (
    await importRaw(import.meta.resolve("./hooks/fish.fish"))
  ),
};

async function detectShell(): Promise<string> {
  let path = Deno.env.get("SHELL");
  if (!path) {
    try {
      path = await spawnOutput([
        "ps",
        "-p",
        String(Deno.ppid),
        "-o",
        "comm=",
      ]);
    } catch (err) {
      throw new Error(`cannot get parent process name: ${err}`);
    }
  }
  return std_path.basename(path, ".exe").toLowerCase().trim();
}
async function unpackVFS(baseDir: string): Promise<void> {
  await Deno.mkdir(baseDir, { recursive: true });

  for (const [subpath, content] of Object.entries(hookVfs)) {
    const path = std_path.resolve(baseDir, subpath);
    if (content === null) {
      await Deno.remove(path);
    } else {
      await Deno.mkdir(std_path.dirname(path), { recursive: true });
      await Deno.writeTextFile(path, content.trim());
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

export async function install() {
  if (Deno.build.os == "windows") {
    throw new Error("windows is not yet supported :/");
  }
  const { homeDir, shareDir } = dirs();
  logger().debug("installing hooks", { shareDir });
  await unpackVFS(shareDir);
  const shell = await detectShell();
  if (shell === "fish") {
    await filterAddFile(
      std_path.resolve(homeDir, ".config/fish/config.fish"),
      /\.local\/share\/ghjk\/hooks\/hook.fish/,
      ". $HOME/.local/share/ghjk/hooks/hook.fish",
    );
  } else if (shell === "bash") {
    await filterAddFile(
      std_path.resolve(homeDir, ".bashrc"),
      /\.local\/share\/ghjk\/hooks\/hook.sh/,
      ". $HOME/.local/share/ghjk/hooks/hook.sh",
    );
  } else if (shell === "zsh") {
    await filterAddFile(
      std_path.resolve(homeDir, ".zshrc"),
      /\.local\/share\/ghjk\/hooks\/hook.sh/,
      ". $HOME/.local/share/ghjk/hooks/.zshenv",
    );
  } else {
    throw new Error(`unsupported shell: ${shell}`);
  }
  const skipBinInstall = Deno.env.get("GHJK_SKIP_EXE_INSTALL");
  if (!skipBinInstall && skipBinInstall != "0" && skipBinInstall != "false") {
    switch (Deno.build.os) {
      case "linux":
      case "freebsd":
      case "solaris":
      case "illumos":
      case "darwin": {
        // TODO: respect xdg dirs
        const exeDir = Deno.env.get("GHJK_EXE_INSTALL_DIR") ??
          std_path.resolve(homeDir, ".local", "bin");
        await std_fs.ensureDir(exeDir);
        const exePath = std_path.resolve(exeDir, `ghjk`);
        logger().debug("installing executable", { exePath });
        await Deno.writeTextFile(
          exePath,
          `#!/bin/sh 
deno run --unstable-worker-options -A  ${import.meta.resolve("../main.ts")} $*`,
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
