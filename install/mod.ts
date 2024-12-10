//! this installs the different shell ghjk hooks in ~/.local/share/ghjk
//! and a `ghjk` bin at ~/.local/share/bin

// TODO: explore installing deno.lock from ghjk repo and
// relying on --frozen-lockfile

import getLogger from "../utils/logger.ts";
import { $, dirs, importRaw } from "../utils/mod.ts";
import type { Path } from "../utils/mod.ts";

const logger = getLogger(import.meta);

// TODO: calculate and add integrity hashes to these raw imports
// as they won't be covered by deno.lock
// - use pre-commit-hook plus ghjk tasks to do find+replace
// null means it should be removed (for cleaning up old versions)
const getHooksVfs = async () => ({
  "env.sh": (
    await importRaw(import.meta.resolve("./hook.sh"))
  ),

  "env.zsh": (
    await importRaw(import.meta.resolve("./hook.sh"))
  ),

  // for non-interactive zsh, use ZDOTDIR and .zshenv
  ".zshenv": (
    await importRaw(import.meta.resolve("./noninteractive.zsh"))
  ),

  "env.bash": [
    "# importing bash-preexec, see the ghjk hook at then end\n\n",
    await importRaw(
      import.meta.resolve("./bash-preexec.sh"),
    ),
    await importRaw(import.meta.resolve("./hook.sh")),
  ].join("\n"),

  "env.fish": (
    await importRaw(import.meta.resolve("./hook.fish"))
  ),
});

async function unpackVFS(
  vfs: Record<string, string>,
  baseDirRaw: Path,
  replacements: [RegExp, string][],
): Promise<void> {
  const baseDir = await $.path(baseDirRaw).ensureDir();

  for (const [subpath, content] of Object.entries(vfs)) {
    const path = baseDir.join(subpath);
    if (content === null) {
      await path.remove({ recursive: true });
    } else {
      let text = content.trim();
      for (const [re, repl] of replacements) {
        text = text.replace(re, repl);
      }
      await path.parentOrThrow().ensureDir();
      await path.writeText(text);
    }
  }
}

async function filterAddContent(
  path: Path,
  marker: RegExp,
  content: string | null,
) {
  const file = await path.readText()
    .catch(async (err) => {
      if (err instanceof Deno.errors.NotFound) {
        await $.path(path).parentOrThrow().ensureDir();
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

  await path.writeText(lines.join("\n"));
}

interface InstallArgs {
  homeDir: string;
  ghjkDataDir: string;
  ghjkConfigDir: string;
  shellsToHook?: string[];
  /** The mark used when adding the hook to the user's shell rcs.
   * Override to allow multiple hooks in your rc.
   */
  shellHookMarker: string;
}

export const defaultInstallArgs: InstallArgs = {
  ghjkDataDir: $.path(dirs().shareDir).resolve("ghjk").toString(),
  homeDir: dirs().homeDir,
  shellsToHook: [],
  shellHookMarker: "ghjk-hook-default",
  ghjkConfigDir: $.path(dirs().configDir).toString(),
};

const shellConfig: Record<string, string> = {
  fish: ".config/fish/config.fish",
  bash: ".bashrc",
  zsh: ".zshrc",
};

export async function install(
  args: InstallArgs = defaultInstallArgs,
) {
  logger.debug("installing", args);

  if (Deno.build.os == "windows") {
    throw new Error("windows is not yet supported, please use wsl");
  }
  const ghjkDataDir = $.path(Deno.cwd())
    .resolve(args.ghjkDataDir);

  logger.info("unpacking vfs", { ghjkDataDir });
  await unpackVFS(
    await getHooksVfs(),
    ghjkDataDir,
    [[/__GHJK_SHARE_DIR__/g, ghjkDataDir.toString()]],
  );
  for (const shell of args.shellsToHook ?? Object.keys(shellConfig)) {
    const { homeDir } = args;

    if (!(shell in shellConfig)) {
      throw new Error(`unsupported shell: ${shell}`);
    }

    const rcPath = $.path(homeDir).join(shellConfig[shell]);
    // if the shell rc file isn't detected and we're hooking
    // the default shell set, just skip it
    if (!await rcPath.exists() && !args.shellsToHook) {
      continue;
    }
    logger.info("installing hook", {
      ghjkDataDir,
      shell,
      marker: args.shellHookMarker,
      rcPath,
    });
    await filterAddContent(
      rcPath,
      new RegExp(args.shellHookMarker, "g"),
      `. ${ghjkDataDir}/env.${shell} # ${args.shellHookMarker}`,
    );
  }
}
