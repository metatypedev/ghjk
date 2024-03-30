import { std_fs, std_path } from "../../deps/cli.ts";
import type {
  EnvRecipeX,
  Provision,
  WellKnownEnvRecipeX,
  WellKnownProvision,
} from "./types.ts";
import validators from "./types.ts";
import { wellKnownProvisionTypes } from "./types.ts";
import getLogger from "../../utils/logger.ts";
import { $, PathRef } from "../../utils/mod.ts";
import type { GhjkCtx } from "../types.ts";
import { getProvisionReducerStore } from "./reducer.ts";

const logger = getLogger(import.meta);

export async function reduceStrangeProvisions(
  gcx: GhjkCtx,
  env: EnvRecipeX,
) {
  const reducerStore = getProvisionReducerStore(gcx);
  const bins = {} as Record<string, Provision[]>;
  for (const item of env.provides) {
    let bin = bins[item.ty];
    if (!bin) {
      bin = [];
      bins[item.ty] = bin;
    }
    bin.push(item);
  }
  const reducedSet = [] as WellKnownProvision[];
  for (const [ty, items] of Object.entries(bins)) {
    if (wellKnownProvisionTypes.includes(ty as any)) {
      reducedSet.push(
        ...items.map((item) => validators.wellKnownProvision.parse(item)),
      );
      continue;
    }
    const reducer = reducerStore.get(ty);
    if (!reducer) {
      throw new Error(`no provider reducer found for ty: ${ty}`, {
        cause: items,
      });
    }
    const reduced = await reducer(items);
    reducedSet.push(validators.wellKnownProvision.parse(reduced));
  }
  const out: WellKnownEnvRecipeX = {
    ...env,
    provides: reducedSet,
  };
  return out;
}

export async function cookUnixEnv(
  env: WellKnownEnvRecipeX,
  envDir: string,
  createShellLoaders = true,
) {
  // create the shims for the user's environment
  const shimDir = $.path(envDir).join("shims");
  await $.removeIfExists(shimDir);

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
  const vars = {} as Record<string, string>;
  // FIXME: detect shim conflicts
  // FIXME: better support for multi installs

  await Promise.all(env.provides.map((item) => {
    switch (item.ty) {
      case "posixExec":
        binPaths.push(item.absolutePath);
        break;
      case "posixSharedLib":
        libPaths.push(item.absolutePath);
        break;
      case "headerFile":
        includePaths.push(item.absolutePath);
        break;
      case "envVar":
        if (vars[item.key]) {
          throw new Error(
            `env var conflict cooking unix env: key "${item.key}" has entries "${
              vars[item.key]
            }" and "${item.val}"`,
          );
        }
        vars[item.key] = vars[item.val];
        break;
      default:
        throw Error(`unsupported provision type: ${(item as any).provision}`);
    }
  }));
  // bin shims
  void await shimLinkPaths(
    binPaths,
    binShimDir,
  );
  // lib shims
  void await shimLinkPaths(
    libPaths,
    libShimDir,
  );
  // include shims
  void await shimLinkPaths(
    includePaths,
    includeShimDir,
  );
  // write loader for the env vars mandated by the installs
  logger.debug("adding vars to loader", vars);
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
    await writeLoader(
      envDir,
      vars,
      pathVars,
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
  shimDir: PathRef,
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
    await shimPath.createSymlinkTo(filePath, { kind: "absolute" });
    shims[fileName] = shimPath.toString();
  }
  return shims;
}

// create the loader scripts
// loader scripts are responsible for exporting
// different environment variables from the ports
// and mainpulating the path strings
async function writeLoader(
  envDir: string,
  env: Record<string, string>,
  pathVars: Record<string, string>,
) {
  const loader = {
    posix: [
      `export GHJK_CLEANUP_POSIX="";`,
      ...Object.entries(env).map(([k, v]) =>
        // NOTE: single quote the port supplied envs to avoid any embedded expansion/execution
        `GHJK_CLEANUP_POSIX=$GHJK_CLEANUP_POSIX"export ${k}='$${k}';";
export ${k}='${v}';`
      ),
      ...Object.entries(pathVars).map(([k, v]) =>
        // NOTE: double quote the path vars for expansion
        // single quote GHJK_CLEANUP additions to avoid expansion/exec before eval
        `GHJK_CLEANUP_POSIX=$GHJK_CLEANUP_POSIX'${k}=$(echo "$${k}" | tr ":" "\\n" | grep -vE "^${envDir}" | tr "\\n" ":");${k}="\${${k}%:}";';
export ${k}="${v}:$${k}";
`
      ),
    ].join("\n"),
    fish: [
      `set --erase GHJK_CLEANUP_FISH`,
      ...Object.entries(env).map(([k, v]) =>
        `set --global --append GHJK_CLEANUP_FISH "set --global --export ${k} '$${k}';";
set --global --export ${k} '${v}';`
      ),
      ...Object.entries(pathVars).map(([k, v]) =>
        `set --global --append GHJK_CLEANUP_FISH 'set --global --export --path ${k} (string match --invert --regex "^${envDir}" $${k});';
set --global --export --prepend ${k} ${v};
`
      ),
    ].join("\n"),
  };
  const envPathR = await $.path(envDir).ensureDir();
  await Promise.all([
    envPathR.join(`loader.fish`).writeText(loader.fish),
    envPathR.join(`loader.sh`).writeText(loader.posix),
  ]);
}
