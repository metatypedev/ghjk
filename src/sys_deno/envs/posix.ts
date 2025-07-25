import { std_fs, std_path } from "./deps.ts";
import {
  type EnvRecipe,
  WellKnownProvision,
  wellKnownProvisionTypes,
} from "./types.ts";
import { $, Path, promiseCollector } from "../../deno_utils/mod.ts";
import type { GhjkCtx } from "../types.ts";
import { reduceStrangeProvisions } from "./reducer.ts";
import getLogger from "../../deno_utils/logger.ts";

const logger = getLogger(import.meta);

export async function cookPosixEnv(
  { gcx, recipe, envKey, envDir, createShellLoaders = false }: {
    gcx: GhjkCtx;
    recipe: EnvRecipe;
    envKey: string;
    envDir: string;
    createShellLoaders?: boolean;
  },
) {
  logger.debug("cooking env", envKey, { envDir });
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
    GHJK_ENV: envKey,
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
      // case "posix.envVarDyn":
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
          `unsupported provision type: ${(wellKnownProv as any).ty}`,
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
  const promises = promiseCollector();
  // a work sack to append to incase there are globs expanded
  const foundTargetPaths = [...targetPaths];
  while (foundTargetPaths.length > 0) {
    const file = foundTargetPaths.pop()!;
    if (std_path.isGlob(file)) {
      foundTargetPaths.push(
        // deno-lint-ignore no-await-in-loop
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
        `duplicate shim found when adding shim for file: "${fileName}"`,
      );
    }
    try {
      // deno-lint-ignore no-await-in-loop
      await $.path(shimPath).remove();
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
    promises.push(shimPath.symlinkTo(filePath, { kind: "absolute" }));
    shims[fileName] = shimPath.toString();
  }
  await promises.finish();
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
  envVars: Record<string, string>,
  pathVars: Record<string, string>,
  onEnterHooks: [string, string[]][],
  onExitHooks: [string, string[]][],
) {
  const ghjkDirVar = "_ghjk_dir";
  const dataDirVar = "_ghjk_data_dir";
  pathVars = {
    ...Object.fromEntries(
      Object.entries(pathVars).map((
        [key, val],
      ) => [
        key,
        val
          .replace(gcx.ghjkDir.toString(), "$" + ghjkDirVar)
          .replace(gcx.ghjkDataDir.toString(), "$" + dataDirVar),
      ]),
    ),
  };

  const ghjkShimName = "__ghjk_shim";
  const onEnterHooksEscaped = onEnterHooks.map(([cmd, args]) =>
    [cmd == "ghjk" ? ghjkShimName : cmd, ...args]
      .join(" ")
      .replaceAll("'", "'\\''")
  );
  const onExitHooksEscaped = onExitHooks.map(([cmd, args]) =>
    [cmd == "ghjk" ? ghjkShimName : cmd, ...args]
      .join(" ").replaceAll("'", "'\\''")
  );

  const scripts = {
    //
    // posix shell version
    posix: [
      `# shellcheck shell=sh`,
      `# shellcheck disable=SC2016`,
      `# SC2016: disabled because single quoted expressions are used for the cleanup scripts`,
      ``,
      `# this file must be sourced from an existing sh/bash/zsh session using the \`source\` command`,
      `# it should be executed directly`,
      ``,
      `ghjk_deactivate () {`,
      `    if [ -n "$\{GHJK_CLEANUP_POSIX+x}" ]; then`,
      `        eval "$GHJK_CLEANUP_POSIX"`,
      `        unset GHJK_CLEANUP_POSIX`,
      `    fi`,
      `}`,
      `ghjk_deactivate`,
      ``,
      ``,
      `# the following variables are used to make the script more human readable`,
      `${ghjkDirVar}="${gcx.ghjkDir.toString()}"`,
      `${dataDirVar}="${gcx.ghjkDataDir.toString()}"`,
      ``,
      `export GHJK_CLEANUP_POSIX="";`,
      `# env vars`,
      `# we keep track of old values before this script is run`,
      `# so that we can restore them on cleanup`,
      ...Object.entries(envVars).flatMap(([key, val]) => {
        const safeVal = val.replaceAll("\\", "\\\\").replaceAll("'", "'\\''");
        // avoid triggering unbound variable if -e is set
        // by defaulting to a value that's guranteed to
        // be differeint than `key`
        // TODO: avoid invalid key values elsewhere
        const safeComparisionKey = `$\{${key}:-_${
          val.replace(/['"]/g, "").slice(0, 2)
        }}`;
        return [
          // we only restore the old $KEY value at cleanup if value of $KEY
          // is the one set by the activate script
          // we also single quote the supplied values to avoid
          // any embedded expansion/execution
          // we also single quote the entire test section to avoid
          // expansion when creating the cleanup
          // string (that's why we "escaped single quote" the value)
          // NOTE: the addition sign at the end
          `GHJK_CLEANUP_POSIX=$GHJK_CLEANUP_POSIX'[ \"${safeComparisionKey}\" = '\\''${safeVal}'\\'' ] && '` +
          // we want to capture the old $key value here so we wrap those
          // with double quotes but the rest is in single quotes
          // within the value of $key
          // i.e. export KEY='OLD $VALUE OF KEY'
          // but $VALUE won't be expanded when the cleanup actually runs
          // we also unset the key if it wasn't previously set
          `$([ -z "$\{${key}+x}" ] && echo 'unset ${key};' || echo 'export ${key}='\\'"$\{${key}:-unreachable}""';");`,
          `export ${key}='${safeVal}';`,
          ``,
        ];
      }),
      ``,
      `# path vars`,
      ...Object.entries(pathVars).flatMap(([key, val]) => {
        const safeVal = val.replaceAll("\\", "\\\\").replaceAll("'", "'\\''");
        return [
          // double quote the path vars for expansion
          // single quote GHJK_CLEANUP additions to avoid expansion/exec before eval
          `GHJK_CLEANUP_POSIX=$GHJK_CLEANUP_POSIX'${key}=$(echo "$${key}" | tr ":" "\\n" | grep -vE '\\'"^${safeVal}"\\'' | tr "\\n" ":");${key}="\${${key}%:}";';`,
          //  FIXME: we're allowing expansion in the value to allow
          //  readable $ghjkDirVar usage
          // (for now safe since all paths are created within ghjk)
          `export ${key}="${safeVal}:$\{${key}-}";`,
          ``,
        ];
      }),
      ``,
      `# hooks that want to invoke ghjk are made to rely`,
      `# on this shim to improve reliablity`,
      ghjk_sh(gcx, ghjkShimName),
      ``,
      `# only run the hooks in interactive mode`,
      `case "$-" in`,
      `    *i*) # if the shell variables contain "i"`,
      ``,
      `        # on enter hooks`,
      ...onEnterHooksEscaped.map((line) => `        ${line}`),
      ``,
      `        # on exit hooks`,
      ...onExitHooksEscaped.map(
        (cmd) => `        GHJK_CLEANUP_POSIX=$GHJK_CLEANUP_POSIX'${cmd};';`,
      ),
      `        :`,
      `    ;;`,
      `    *)`,
      `        :`,
      `    ;;`,
      `esac`,
      ``,
    ],
    //
    // fish version
    fish: [
      `# this file must be sourced from an existing fish session using the \`source\` command`,
      `# it should be executed directly`,
      ``,
      `function ghjk_deactivate`,
      `    if set --query GHJK_CLEANUP_FISH`,
      `        eval $GHJK_CLEANUP_FISH`,
      `        set --erase GHJK_CLEANUP_FISH`,
      `    end`,
      `end`,
      `ghjk_deactivate`,
      ``,
      `# the following variables are used to make the script more human readable`,
      `set ${ghjkDirVar} "${gcx.ghjkDir.toString()}"`,
      `set ${dataDirVar} "${gcx.ghjkDataDir.toString()}"`,
      ``,
      `# env vars`,
      `# we keep track of old values before this script is run`,
      `# so that we can restore them on cleanup`,
      ...Object.entries(envVars).flatMap(([key, val]) => {
        const safeVal = val.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
        // read the comments from the posix version of this section
        // the fish version is notably simpler since
        // - we can escape single quotes within single quotes
        // - we don't have to deal with 'set -o nounset'
        return [
          `set --global --append GHJK_CLEANUP_FISH 'test "$${key}" = \\'${safeVal}\\'; and '` +
          `(if set -q ${key}; echo 'set --global --export ${key} \\''"$${key}""';"; else; echo 'set -e ${key};'; end;);`,
          `set --global --export ${key} '${val}';`,
          ``,
        ];
      }),
      ``,
      `# path vars`,
      ...Object.entries(pathVars).flatMap(([key, val]) => {
        const safeVal = val.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
        return [
          `set --global --append GHJK_CLEANUP_FISH 'set --global --export --path ${key} (string match --invert --regex \\''"^${safeVal}"'\\' $${key});';`,
          `set --global --export --prepend ${key} "${safeVal}";`,
          ``,
        ];
      }),
      ``,
      `# hooks that want to invoke ghjk are made to rely`,
      `# on this shim to improve to improve reliablity`,
      ghjk_fish(gcx, ghjkShimName),
      ``,
      `# only run the hooks in interactive mode`,
      `if status is-interactive;`,
      `    # on enter hooks`,
      ...onEnterHooksEscaped.map((line) => `    ${line}`),
      ,
      ``,
      `    # on exit hooks`,
      ...onExitHooksEscaped.map((cmd) =>
        `    set --global --append GHJK_CLEANUP_FISH '${cmd};';`
      ),
      `end`,
    ],
  };

  const envPathR = await $.path(envDir).ensureDir();
  await Promise.all([
    envPathR.join(`activate.fish`).writeText(scripts.fish.join("\n")),
    envPathR.join(`activate.sh`).writeText(scripts.posix.join("\n")),
  ]);
}

/**
 * Returns a simple posix function to invoke the ghjk CLI.
 * This shim assumes it's running inside the ghjk embedded deno runtime.
 */
export function ghjk_sh(
  gcx: GhjkCtx,
  functionName = "__ghjk_shim",
) {
  return `${functionName} () {
    GHJKDIR="${gcx.ghjkDir}" \\
    ${Deno.execPath()} "$@"
}`;
}

/**
 * Returns a simple fish function to invoke the ghjk CLI.
 * This shim assumes it's running inside the ghjk embedded deno runtime.
 */
export function ghjk_fish(
  gcx: GhjkCtx,
  functionName = "__ghjk_shim",
) {
  return `function ${functionName}
    GHJKDIR="${gcx.ghjkDir}" \\
    ${Deno.execPath()}  $argv
end`;
}
