import { std_fs, std_path } from "../../deps/cli.ts";
import {
  type EnvRecipeX,
  WellKnownProvision,
  wellKnownProvisionTypes,
} from "./types.ts";
import { $, Path } from "../../utils/mod.ts";
import type { GhjkCtx } from "../types.ts";
import { reduceStrangeProvisions } from "./reducer.ts";
import { ghjk_fish, ghjk_sh } from "../../install/utils.ts";
import getLogger from "../../utils/logger.ts";

const logger = getLogger(import.meta);

export async function cookPosixEnv(
  { gcx, recipe, envName, envDir, createShellLoaders = false }: {
    gcx: GhjkCtx;
    recipe: EnvRecipeX;
    envName: string;
    envDir: string;
    createShellLoaders?: boolean;
  },
) {
  logger.debug("cooking env", envName, { envDir });
  const reducedRecipe = await reduceStrangeProvisions(gcx, recipe);
  await $.removeIfExists(envDir);
  // create the shims for the user's environment
  const shimDir = $.path(envDir).join("shims");

  const [binShimDir, libShimDir, includeShimDir] = await Promise.all([
    shimDir.join("bin").ensureDir(),
    shimDir.join("lib").ensureDir(),
    shimDir.join("include").ensureDir(),
  ]);

  // extract the env vars exported by the user specified
  // installs and shim up their exported artifacts
  const binPaths = [] as string[];
  const libPaths = [] as string[];
  const includePaths = [] as string[];
  const vars = {
    GHJK_ENV: envName,
  } as Record<string, string>;
  const onEnterHooks = [] as [string, string[]][];
  const onExitHooks = [] as [string, string[]][];
  // FIXME: detect shim conflicts
  // FIXME: better support for multi installs

  await Promise.all(reducedRecipe.provides.map((item) => {
    if (!wellKnownProvisionTypes.includes(item.ty)) {
      return Promise.resolve();
    }

    const wellKnownProv = item as WellKnownProvision;
    switch (wellKnownProv.ty) {
      case "posix.exec":
        binPaths.push(wellKnownProv.absolutePath);
        break;
      case "posix.sharedLib":
        libPaths.push(wellKnownProv.absolutePath);
        break;
      case "posix.headerFile":
        includePaths.push(wellKnownProv.absolutePath);
        break;
      case "posix.envVar":
        if (vars[wellKnownProv.key]) {
          throw new Error(
            `env var conflict cooking unix env: key "${wellKnownProv.key}" has entries "${
              vars[wellKnownProv.key]
            }" and "${wellKnownProv.val}"`,
          );
        }
        vars[wellKnownProv.key] = wellKnownProv.val;
        // installSetIds.push(wellKnownProv.installSetIdProvision!.id);
        break;
      case "hook.onEnter.posixExec":
        onEnterHooks.push([wellKnownProv.program, wellKnownProv.arguments]);
        break;
      case "hook.onExit.posixExec":
        onExitHooks.push([wellKnownProv.program, wellKnownProv.arguments]);
        break;
      case "ghjk.ports.Install":
        // do nothing
        break;
      default:
        throw Error(
          `unsupported provision type: ${(wellKnownProv as any).provision}`,
        );
    }
  }));
  void await Promise.all([
    // bin shims
    await shimLinkPaths(
      binPaths,
      binShimDir,
    ),
    // lib shims
    await shimLinkPaths(
      libPaths,
      libShimDir,
    ),
    // include shims
    await shimLinkPaths(
      includePaths,
      includeShimDir,
    ),
    $.path(envDir).join("recipe.json").writeJsonPretty(reducedRecipe),
  ]);
  // FIXME: prevent malicious env manipulations
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
  const pathVars = {
    PATH: `${envDir}/shims/bin`,
    LIBRARY_PATH: `${envDir}/shims/lib`,
    [LD_LIBRARY_ENV]: `${envDir}/shims/lib`,
    C_INCLUDE_PATH: `${envDir}/shims/include`,
    CPLUS_INCLUDE_PATH: `${envDir}/shims/include`,
  };
  if (createShellLoaders) {
    // write loader for the env vars mandated by the installs
    await writeActivators(
      gcx,
      envDir,
      vars,
      pathVars,
      onEnterHooks,
      onExitHooks,
    );
  }
  return {
    env: {
      ...vars,
      ...pathVars,
    },
  };
}

/// This expands globs found in the targetPaths
async function shimLinkPaths(
  targetPaths: string[],
  shimDir: Path,
) {
  // map of filename to shimPath
  const shims: Record<string, string> = {};
  // a work sack to append to incase there are globs expanded
  const foundTargetPaths = [...targetPaths];
  while (foundTargetPaths.length > 0) {
    const file = foundTargetPaths.pop()!;
    if (std_path.isGlob(file)) {
      foundTargetPaths.push(
        ...(await Array.fromAsync(std_fs.expandGlob(file)))
          .map((entry) => entry.path),
      );
      continue;
    }
    const filePath = $.path(file);
    const fileName = filePath.basename();
    const shimPath = shimDir.resolve(fileName);

    if (shims[fileName]) {
      throw new Error(
        `duplicate shim found when adding shim for file "${fileName}"`,
      );
    }
    try {
      await $.path(shimPath).remove();
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
    await shimPath.symlinkTo(filePath, { kind: "absolute" });
    shims[fileName] = shimPath.toString();
  }
  return shims;
}

/**
 * Create the activate scripts.
 *
 * Activate scripts are responsible for:
 * - exporting different environment variables from the ports
 * - mainpulating the path strings
 * - running the environment hooks
 */
async function writeActivators(
  gcx: GhjkCtx,
  envDir: string,
  env: Record<string, string>,
  pathVars: Record<string, string>,
  onEnterHooks: [string, string[]][],
  onExitHooks: [string, string[]][],
) {
  // ghjk.sh sets the DENO_DIR so we can usually
  // assume it's set
  const denoDir = Deno.env.get("DENO_DIR") ?? "";
  const ghjkShimName = "__ghjk_shim";
  const onEnterHooksEscaped = onEnterHooks.map(
    ([cmd, args]) =>
      [cmd == "ghjk" ? ghjkShimName : cmd, ...args]
        .join(" ").replaceAll("'", "'\\''"),
  );
  const onExitHooksEscaped = onExitHooks.map(
    ([cmd, args]) =>
      [cmd == "ghjk" ? ghjkShimName : cmd, ...args]
        .join(" ").replaceAll("'", "'\\''"),
  );
  const activate = {
    //
    // posix shell version
    posix: [
      `if [ -n "$\{GHJK_CLEANUP_POSIX+x}" ]; then
    eval "$GHJK_CLEANUP_POSIX"
fi`,
      `export GHJK_CLEANUP_POSIX="";`,
      "\n# env vars",
      ...Object.entries(env).map(([key, val]) =>
        // NOTE: single quote the port supplied envs to avoid any embedded expansion/execution
        `GHJK_CLEANUP_POSIX=$GHJK_CLEANUP_POSIX"export ${key}='$${key}';";
export ${key}='${val}';`
      ),
      "\n# path vars",
      ...Object.entries(pathVars).map(([key, val]) =>
        // NOTE: double quote the path vars for expansion
        // single quote GHJK_CLEANUP additions to avoid expansion/exec before eval
        `GHJK_CLEANUP_POSIX=$GHJK_CLEANUP_POSIX'${key}=$(echo "$${key}" | tr ":" "\\n" | grep -vE "^${val}" | tr "\\n" ":");${key}="\${${key}%:}";';
export ${key}="${val}:$${key}";
`
      ),
      "\n# hooks that want to invoke ghjk are made to rely",
      "# on this shim instead improving latency",
      ghjk_sh(gcx, denoDir, ghjkShimName),
      "\n# on enter hooks",
      ...onEnterHooksEscaped,
      "\n# on exit hooks",
      ...onExitHooksEscaped.map(
        (command) => `GHJK_CLEANUP_POSIX=$GHJK_CLEANUP_POSIX'${command};';`,
      ),
    ].join("\n"),
    //
    // fish version
    fish: [
      `if set --query GHJK_CLEANUP_FISH
    eval $GHJK_CLEANUP_FISH
    set --erase GHJK_CLEANUP_FISH
end`,
      "\n# env vars",
      ...Object.entries(env).map(([key, val]) =>
        `set --global --append GHJK_CLEANUP_FISH "set --global --export ${key} '$${key}';";
set --global --export ${key} '${val}';`
      ),
      "\n# path vars",
      ...Object.entries(pathVars).map(([key, val]) =>
        `set --global --append GHJK_CLEANUP_FISH 'set --global --export --path ${key} (string match --invert --regex "^${val}" $${key});';
set --global --export --prepend ${key} ${val};
`
      ),
      "\n# hooks that want to invoke ghjk are made to rely",
      "# on this shim instead improving latency",
      ghjk_fish(gcx, denoDir, ghjkShimName),
      "\n# on enter hooks",
      ...onEnterHooksEscaped,
      "\n# on exit hooks",
      ...onExitHooksEscaped.map(
        (command) => `set --global --append GHJK_CLEANUP_FISH '${command};';`,
      ),
    ].join("\n"),
  };

  const envPathR = await $.path(envDir).ensureDir();
  await Promise.all([
    envPathR.join(`activate.fish`).writeText(activate.fish),
    envPathR.join(`activate.sh`).writeText(activate.posix),
  ]);
}
