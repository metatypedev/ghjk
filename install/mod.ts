import { std_path } from "../deps/cli.ts";
import { dirs, importRaw } from "../cli/utils.ts";
import { spawnOutput } from "../utils/mod.ts";

let LD_LIBRARY_ENV: string;
switch (Deno.build.os) {
  case "darwin":
    LD_LIBRARY_ENV = "DYLD_LIBRARY_PATH";
    break;
  case "linux":
    LD_LIBRARY_ENV = "LD_LIBRARY_PATH";
    break;
  default:
    throw new Error(`unsupported os ${Deno.build.os}`);
}

// null means it should be removed (for cleaning up old versions)
const vfs = {
  // the script executed when users use the ghjk command
  "hooks/entrypoint.ts": `
import { main } from "${import.meta.resolve("../host/mod.ts")}";

await main();
`,

  "hooks/bash-preexec.sh": await importRaw(
    "https://raw.githubusercontent.com/rcaloras/bash-preexec/0.5.0/bash-preexec.sh",
  ),

  "hooks/.zshenv": (
    await importRaw(import.meta.resolve("./hooks/zsh.zsh"))
  )
    .replaceAll("__var_LD_LIBRARY_ENV__", LD_LIBRARY_ENV),
  // the hook run before every prompt draw in bash
  "hooks/hook.sh": (
    await importRaw(import.meta.resolve("./hooks/bash.sh"))
  )
    .replaceAll("__var_LD_LIBRARY_ENV__", LD_LIBRARY_ENV),

  "hooks/hook.fish": (
    await importRaw(import.meta.resolve("./hooks/fish.fish"))
  )
    .replaceAll("__var_LD_LIBRARY_ENV__", LD_LIBRARY_ENV),
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

  for (const [subpath, content] of Object.entries(vfs)) {
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
  const { homeDir, shareDir } = dirs();
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
}
