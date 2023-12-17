import { std_fs, std_path, zod } from "../../deps/cli.ts";
import logger from "../../utils/logger.ts";
import validators, {
  AmbientAccessPortManifestX,
  DenoWorkerPortManifestX,
  DepShims,
  InstallConfigLite,
  InstallConfigLiteX,
  PortArgsBase,
  PortManifestX,
  PortsModuleConfig,
} from "./types.ts";
import { DenoWorkerPort } from "./worker.ts";
import { AmbientAccessPort } from "./ambient.ts";
import { AsdfPort } from "./asdf.ts";
import { $, AVAIL_CONCURRENCY, getInstallHash } from "../../utils/mod.ts";

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
        `GHJK_CLEANUP_POSIX=$GHJK_CLEANUP_POSIX'${k}=$(echo "$${k}" | tr ":" "\\n" | grep -vE "^${envDir}" | tr "\\n" ":");${k}="\${${k}%:}"';
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
        `set --global --append GHJK_CLEANUP_FISH 'set --global --path ${k} (string match --invert --regex "^${envDir}" $${k});';
set --global --prepend ${k} ${v};
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

export async function sync(
  ghjkDir: string,
  envDir: string,
  cx: PortsModuleConfig,
) {
  const ghjkPathR = $.path(ghjkDir);
  const [installsPath, downloadsPath, tmpPath] = (await Promise.all([
    ghjkPathR.join("installs").ensureDir(),
    ghjkPathR.join("downloads").ensureDir(),
    ghjkPathR.join("tmp").ensureDir(),
  ])).map($.pathToString);
  const installs = await buildInstallGraph(cx);
  const artifacts = new Map<string, InstallArtifacts>();
  const pendingInstalls = [...installs.indie];
  while (pendingInstalls.length > 0) {
    const installId = pendingInstalls.pop()!;
    const inst = installs.all.get(installId)!;

    const manifest = cx.ports[inst.portId] ??
      cx.allowedDeps[inst.portId]!;
    const depShims: DepShims = {};

    // create the shims for the deps
    const depShimsRootPath = await Deno.makeTempDir({
      dir: tmpPath,
      prefix: `ghjk_dep_shims_${installId}_`,
    });
    for (const depId of manifest.deps ?? []) {
      const depPort = cx.allowedDeps[depId.id]!;
      const depInstall = {
        portId: depPort.name,
      };
      const depInstallId = await getInstallHash(depInstall);
      const depArtifacts = artifacts.get(depInstallId);
      if (!depArtifacts) {
        throw new Error(
          `artifacts not found for plug dep "${depInstallId}" when installing "${installId}"`,
        );
      }
      const depShimDir = std_path.resolve(depShimsRootPath, depInstallId);
      await $.path(depShimDir).ensureDir();
      // TODO: expose LD_LIBRARY from deps

      const { binPaths, installPath } = depArtifacts;
      depShims[depId.id] = await shimLinkPaths(
        binPaths,
        installPath,
        depShimDir,
      );
    }

    let thisArtifacts;
    try {
      thisArtifacts = await doInstall(
        installsPath,
        downloadsPath,
        tmpPath,
        inst,
        manifest,
        depShims,
      );
    } catch (err) {
      throw new Error(`error installing ${installId}`, { cause: err });
    }
    artifacts.set(installId, thisArtifacts);
    void $.path(depShimsRootPath).remove({ recursive: true });

    // mark where appropriate if some other install was depending on it
    const parents = installs.revDepEdges.get(installId) ?? [];
    for (const parentId of parents) {
      const parentDeps = installs.depEdges.get(parentId)!;

      // swap remove from parent deps
      const idx = parentDeps.indexOf(installId);
      const last = parentDeps.pop()!;
      if (parentDeps.length > idx) {
        parentDeps[idx] = last;
      }

      if (parentDeps.length == 0) {
        pendingInstalls.push(parentId);
      }
    }
  }

  const shimDir = $.path(envDir).join("shims");
  if (await shimDir.exists()) {
    await shimDir.remove({ recursive: true });
  }
  // create shims for the environment
  const [binShimDir, libShimDir, includeShimDir] = await Promise.all([
    shimDir.join("bin").ensureDir(),
    shimDir.join("lib").ensureDir(),
    shimDir.join("include").ensureDir(),
  ]);
  // FIXME: detect conflicts
  for (const instId of installs.user) {
    const { binPaths, libPaths, includePaths, installPath } = artifacts.get(
      instId,
    )!;
    // bin shims
    void await shimLinkPaths(
      binPaths,
      installPath,
      binShimDir.toString(),
    );
    // lib shims
    void await shimLinkPaths(
      libPaths,
      installPath,
      libShimDir.toString(),
    );
    // include shims
    void await shimLinkPaths(
      includePaths,
      installPath,
      includeShimDir.toString(),
    );
  }

  // write loader for the env vars mandated by the installs
  const env: Record<string, [string, string]> = {};
  for (const [instId, item] of artifacts) {
    for (const [key, val] of Object.entries(item.env)) {
      const conflict = env[key];
      if (conflict) {
        throw new Error(
          `duplicate env var found ${key} from sources ${instId} & ${
            conflict[1]
          }`,
        );
      }
      env[key] = [val, instId];
    }
  }
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
  logger().debug("adding vars to loader", env);
  // FIXME: prevent malicious env manipulations
  await writeLoader(
    envDir,
    Object.fromEntries(
      Object.entries(env).map(([key, [val, _]]) => [key, val]),
    ),
    pathVars,
  );
  await $.path(tmpPath).remove();
}

async function buildInstallGraph(cx: PortsModuleConfig) {
  const installs = {
    all: new Map<string, InstallConfigLite>(),
    indie: [] as string[],
    // edges from dependency to dependent
    revDepEdges: new Map<string, string[]>(),
    // edges from dependent to dependency
    depEdges: new Map<string, string[]>(),
    user: new Set<string>(),
    // allowed deps to their install hash
    allowed: new Map<string, string>(),
  };
  const foundInstalls: InstallConfigLite[] = [];
  for (const inst of cx.installs) {
    const instId = await getInstallHash(inst);
    // FIXME: better support for multi installs
    if (installs.user.has(instId)) {
      throw new Error(
        `duplicate install found by plugin "${inst.portId}": ${
          $.inspect(inst)
        }`,
      );
    }
    installs.user.add(instId);
    foundInstalls.push(inst);
  }

  while (foundInstalls.length > 0) {
    const inst = foundInstalls.pop()!;
    const manifest = cx.ports[inst.portId] ??
      cx.allowedDeps[inst.portId];
    if (!manifest) {
      throw new Error(
        `unable to find plugin "${inst.portId}" specified by install: ${
          $.inspect(inst)
        }`,
      );
    }
    const installId = await getInstallHash(inst);

    // we might get multiple instances of an install at this point
    // due to a plugin being a dependency to multiple others
    const conflict = installs.all.get(installId);
    if (conflict) {
      continue;
    }

    installs.all.set(installId, inst);

    if (!manifest.deps || manifest.deps.length == 0) {
      installs.indie.push(installId);
    } else {
      const deps = [];
      for (const depId of manifest.deps) {
        const depPort = cx.allowedDeps[depId.id];
        if (!depPort) {
          throw new Error(
            `unrecognized dependency "${depId.id}" specified by plug "${manifest.name}"`,
          );
        }
        // FIXME: add an install for the std dep and use that hash instead
        // const depInstall = {
        //   portId: depPort.name,
        // };
        let depInstallId = installs.allowed.get(depId.id);
        // if (depInstallId)

        // check for cycles
        {
          const thisDeps = installs.revDepEdges.get(installId);
          if (thisDeps && thisDeps.includes(depInstallId)) {
            throw new Error(
              `cyclic dependency detected between "${installId}" and  "${depInstallId}"`,
            );
          }
        }

        if (!installs.all.has(depInstallId)) {
          foundInstalls.push(depInstall);
        }
        deps.push(depInstallId);

        // make sure the dependency knows this install depends on it
        const reverseDeps = installs.revDepEdges.get(depInstallId) ?? [];
        reverseDeps.push(installId);
        installs.revDepEdges.set(depInstallId, reverseDeps);
      }
      installs.depEdges.set(installId, deps);
    }
  }

  return installs;
}

async function shimLinkPaths(
  targetPaths: string[],
  installPath: string,
  shimDir: string,
) {
  const shims: Record<string, string> = {};
  const foundTargetPaths = [...targetPaths];
  while (foundTargetPaths.length > 0) {
    const file = foundTargetPaths.pop()!;
    if (std_path.isGlob(file)) {
      const glob = file.startsWith("/")
        ? file
        : std_path.joinGlobs([installPath, file], { extended: true });
      for await (const entry of std_fs.expandGlob(glob)) {
        foundTargetPaths.push(entry.path);
      }
      continue;
    }
    const filePath = std_path.resolve(installPath, file);
    const fileName = std_path.basename(filePath); // TODO: aliases
    const shimPath = std_path.resolve(shimDir, fileName);

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
    await $.path(shimPath).createSymlinkTo(filePath, { type: "file" });
    shims[fileName] = shimPath;
  }
  return shims;
}

type DePromisify<T> = T extends Promise<infer Inner> ? Inner : T;
type InstallArtifacts = DePromisify<ReturnType<typeof doInstall>>;

async function doInstall(
  installsDir: string,
  downloadsDir: string,
  tmpDir: string,
  instUnclean: InstallConfigLite,
  manifest: PortManifestX,
  depShims: DepShims,
) {
  logger().debug("installing", {
    installsDir,
    downloadsDir,
    instUnclean,
    port: manifest,
  });
  let port;
  let inst: InstallConfigLiteX;
  if (manifest.ty == "denoWorker@v1") {
    inst = validators.installConfigLite.parse(instUnclean);
    port = new DenoWorkerPort(
      manifest as DenoWorkerPortManifestX,
    );
  } else if (manifest.ty == "ambientAccess@v1") {
    inst = validators.installConfigLite.parse(instUnclean);
    port = new AmbientAccessPort(
      manifest as AmbientAccessPortManifestX,
    );
  } else if (manifest.ty == "asdf@v1") {
    const asdfInst = validators.asdfInstallConfigLite.parse(instUnclean);
    logger().debug(instUnclean);
    inst = asdfInst;
    // FIXME: asdf needs a working dir
    port = await AsdfPort.init(installsDir, asdfInst, depShims);
  } else {
    throw new Error(
      `unsupported plugin type "${(manifest as unknown as any).ty}": ${
        $.inspect(manifest)
      }`,
    );
  }
  const installId = await getInstallHash(inst);
  const installVersion = validators.string.parse(
    inst.version ?? await port.latestStable({
      depShims,
      manifest,
      config: inst,
    }),
  );
  const installPath = std_path.resolve(installsDir, installId);
  const downloadPath = std_path.resolve(downloadsDir, installId);
  const baseArgs: PortArgsBase = {
    installPath: installPath,
    // installType: "version",
    installVersion: installVersion,
    depShims,
    platform: Deno.build,
    config: inst,
    manifest,
  };
  {
    logger().info(`downloading ${installId}:${installVersion}`);
    const tmpDirPath = await Deno.makeTempDir({
      dir: tmpDir,
      prefix: `ghjk_download_${installId}:${installVersion}_`,
    });
    await port.download({
      ...baseArgs,
      downloadPath: downloadPath,
      tmpDirPath,
    });
    void $.path(tmpDirPath).remove({ recursive: true });
  }
  {
    logger().info(`installing ${installId}:${installVersion}`);
    const tmpDirPath = await Deno.makeTempDir({
      dir: tmpDir,
      prefix: `ghjk_install_${installId}@${installVersion}_`,
    });
    await port.install({
      ...baseArgs,
      availConcurrency: AVAIL_CONCURRENCY,
      downloadPath: downloadPath,
      tmpDirPath,
    });
    void $.path(tmpDirPath).remove({ recursive: true });
  }
  const binPaths = validators.stringArray.parse(
    await port.listBinPaths({
      ...baseArgs,
    }),
  );
  const libPaths = validators.stringArray.parse(
    await port.listLibPaths({
      ...baseArgs,
    }),
  );
  const includePaths = validators.stringArray.parse(
    await port.listIncludePaths({
      ...baseArgs,
    }),
  );
  const env = zod.record(zod.string()).parse(
    await port.execEnv({
      ...baseArgs,
    }),
  );
  return { env, binPaths, libPaths, includePaths, installPath, downloadPath };
}
