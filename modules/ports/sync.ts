import { equal, std_fs, std_path, zod } from "../../deps/cli.ts";
import logger from "../../utils/logger.ts";
import validators, {
  AmbientAccessPortManifestX,
  DenoWorkerPortManifestX,
  DepArts,
  InstallConfigLite,
  InstallConfigLiteX,
  PortArgsBase,
  PortManifestX,
  PortsModuleConfig,
} from "./types.ts";
import { DenoWorkerPort } from "./worker.ts";
import { AmbientAccessPort } from "./ambient.ts";
import { $, AVAIL_CONCURRENCY, getInstallHash } from "../../utils/mod.ts";

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

/// this returns a tmp path that's guaranteed to be
/// on the same file system as targetDir by
/// checking if $TMPDIR satisfies that constraint
/// or just pointing to targetDir/tmp
/// This is handy for making moves atomics from
/// tmp dirs to to locations within targetDir
async function movebleTmpPath(targetDir: string, targetTmpDirName = "dir") {
  const defaultTmp = Deno.env.get("TMPDIR");
  const targetPath = $.path(targetDir);
  if (!defaultTmp) {
    return targetPath.join(targetTmpDirName);
  }
  const defaultTmpPath = $.path(defaultTmp);
  if ((await targetPath.stat())?.dev != (await defaultTmpPath.stat())?.dev) {
    return targetPath.join(targetTmpDirName);
  }
  return defaultTmpPath;
}

export async function sync(
  ghjkDir: string,
  envDir: string,
  cx: PortsModuleConfig,
) {
  const ghjkPathR = $.path(ghjkDir);
  // ensure the req
  const [installsPath, downloadsPath, tmpPath] = (
    await Promise.all([
      ghjkPathR.join("ports", "installs").ensureDir(),
      ghjkPathR.join("ports", "downloads").ensureDir(),
      (await movebleTmpPath(ghjkDir)).ensureDir(),
    ])
  ).map($.pathToString);

  const graph = await buildInstallGraph(cx);

  const artifacts = new Map<string, InstallArtifacts>();
  //  start from the ports with no build deps
  const pendingInstalls = [...graph.indie];
  // deep clone graph.depEdges for a list of deps for each port
  // to tick of as we work through the graph
  // initial graph.depEdges is needed intact for other purposes
  const pendingDepEdges = new Map(
    [...graph.depEdges.entries()].map(([key, val]) => [key, [...val]]),
  );
  while (pendingInstalls.length > 0) {
    const installId = pendingInstalls.pop()!;
    const inst = graph.all.get(installId)!;

    const manifest = graph.ports.get(inst.portRef)!;

    // make an object detailing all the artifacts
    // that the port's deps exported
    const totalDepArts: DepArts = {};
    const depShimsRootPath = await Deno.makeTempDir({
      dir: tmpPath,
      prefix: `shims_${installId}_`,
    });
    for (
      const [depInstallId, depPortName] of graph.depEdges.get(installId) ?? []
    ) {
      const depArts = artifacts.get(depInstallId);
      if (!depArts) {
        throw new Error(
          `artifacts not found for plug dep "${depInstallId}" when installing "${installId}"`,
        );
      }
      const depShimDir = $.path(depShimsRootPath).resolve(depInstallId);
      const [binShimDir, libShimDir, includeShimDir] = (await Promise.all([
        depShimDir.join("bin").ensureDir(),
        depShimDir.join("lib").ensureDir(),
        depShimDir.join("include").ensureDir(),
      ])).map($.pathToString);

      totalDepArts[depPortName] = {
        execs: await shimLinkPaths(
          depArts.binPaths,
          depArts.installPath,
          binShimDir,
        ),
        libs: await shimLinkPaths(
          depArts.libPaths,
          depArts.installPath,
          libShimDir,
        ),
        includes: await shimLinkPaths(
          depArts.includePaths,
          depArts.installPath,
          includeShimDir,
        ),
        env: depArts.env,
      };
    }

    let thisArtifacts;
    try {
      thisArtifacts = await doInstall(
        installsPath,
        downloadsPath,
        tmpPath,
        inst.conf,
        manifest,
        totalDepArts,
      );
    } catch (err) {
      throw new Error(`error installing ${installId}`, { cause: err });
    }
    artifacts.set(installId, thisArtifacts);

    void $.removeIfExists(depShimsRootPath);

    // mark where appropriate if some other install was waiting on
    // the current install
    const parents = graph.revDepEdges.get(installId) ?? [];
    for (const parentId of parents) {
      const parentDeps = pendingDepEdges.get(parentId)!;

      // swap remove from parent pending deps list
      const idx = parentDeps.findIndex(([instId, _]) => instId == installId);
      const last = parentDeps.pop()!;
      if (parentDeps.length > idx) {
        parentDeps[idx] = last;
      }

      if (parentDeps.length == 0) {
        // parent is ready for install
        pendingInstalls.push(parentId);
      }
    }
  }

  // create the shims for the user's environment
  const shimDir = $.path(envDir).join("shims");
  await $.removeIfExists(shimDir);

  const [binShimDir, libShimDir, includeShimDir] = await Promise.all([
    shimDir.join("bin").ensureDir(),
    shimDir.join("lib").ensureDir(),
    shimDir.join("include").ensureDir(),
  ]);

  // FIXME: detect conflicts
  // FIXME: better support for multi installs
  for (const instId of graph.user) {
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
  await $.removeIfExists(tmpPath);
}

// this returns a data structure containing all the info
// required for installation including the dependency graph
async function buildInstallGraph(cx: PortsModuleConfig) {
  type GraphInstConf = {
    portRef: string;
    conf: InstallConfigLite;
  };
  // this is all referring to port dependencies
  // TODO: runtime dependencies
  const graph = {
    // maps from instHashId
    all: new Map<string, GraphInstConf>(),
    // list of installs that don't have any dependencies
    indie: [] as string[],
    // maps allowed deps ids to their install hash
    allowed: new Map<string, string>(),
    // list of installs specified by the user (excludes deps)
    user: new Set<string>(),
    // edges from dependency to dependent
    revDepEdges: new Map<string, string[]>(),
    // edges from dependent to dependency [depInstId, portName]
    depEdges: new Map<string, [string, string][]>(),
    // the manifests of the ports
    ports: new Map<string, PortManifestX>(),
  };
  // add port to ports list
  const addPort = (manifest: PortManifestX) => {
    const portRef = `${manifest.name}@${manifest.version}`;

    const conflict = graph.ports.get(portRef);
    if (conflict) {
      if (!equal.equal(conflict, manifest)) {
        throw new Error(
          `differing port manifests found for "${portRef}: ${
            $.inspect(manifest)
          }" != ${$.inspect(conflict)}`,
        );
      }
    } else {
      graph.ports.set(portRef, manifest);
    }

    return portRef;
  };

  const foundInstalls: GraphInstConf[] = [];

  // collect the user specified insts first
  for (const inst of cx.installs) {
    const { port, ...instLiteBase } = inst;
    const portRef = addPort(port);
    const instLite = validators.installConfigLite.parse({
      ...instLiteBase,
      portName: port.name,
    });
    const instId = await getInstallHash(instLite);

    // no dupes allowed in user specified insts
    if (graph.user.has(instId)) {
      throw new Error(
        `duplicate install found for port "${inst.port.name}": ${
          $.inspect(inst)
        }`,
      );
    }
    graph.user.add(instId);
    foundInstalls.push({ portRef, conf: instLite });
  }

  // process each port's dependency trees
  // starting from the user specified insts
  while (foundInstalls.length > 0) {
    const inst = foundInstalls.pop()!;

    const manifest = graph.ports.get(inst.portRef);
    if (!manifest) {
      throw new Error(
        `unable to find port "${inst.portRef}" specified by install: ${
          $.inspect(inst)
        }`,
      );
    }

    const installId = await getInstallHash(inst.conf);

    // there might be multiple instances of an install at this point
    // due to a single plugin being a dependency to multiple others
    const conflict = graph.all.get(installId);
    if (conflict) {
      continue;
    }

    graph.all.set(installId, inst);

    if (!manifest.deps || manifest.deps.length == 0) {
      graph.indie.push(installId);
    } else {
      // this goes into graph.depEdges
      const deps: [string, string][] = [];
      for (const depId of manifest.deps) {
        const { manifest: depPort, defaultInst: defaultDepInstall } =
          cx.allowedDeps[depId.name];
        if (!depPort) {
          throw new Error(
            `unrecognized dependency "${depId.name}" specified by plug "${manifest.name}@${manifest.version}"`,
          );
        }

        // get the install config of dependency
        let depInstall;
        {
          // install configuration of allowed dep ports
          // can be overriden by dependent ports
          const res = validators.installConfigLite.safeParse(
            inst.conf.depConfigs?.[depId.name] ?? defaultDepInstall,
          );
          if (!res.success) {
            throw new Error(
              `error parsing depConfig for "${depId.name}" as specified by "${installId}": ${res.error}`,
            );
          }
          depInstall = res.data;
        }
        const depInstallId = await getInstallHash(depInstall);

        // check for cycles
        {
          const thisDeps = graph.revDepEdges.get(installId);
          if (thisDeps && thisDeps.includes(depInstallId)) {
            throw new Error(
              `cyclic dependency detected between "${installId}" and  "${depInstallId}"`,
            );
          }
        }

        // only add the install configuration for this dep port
        // if specific hash hasn't seen before
        if (!graph.all.has(depInstallId)) {
          const portRef = addPort(depPort);
          foundInstalls.push({ conf: depInstall, portRef });
        }

        deps.push([depInstallId, depPort.name]);

        // make sure the dependency knows this install depends on it
        const reverseDeps = graph.revDepEdges.get(depInstallId) ?? [];
        reverseDeps.push(installId);
        graph.revDepEdges.set(depInstallId, reverseDeps);
      }
      graph.depEdges.set(installId, deps);
    }
  }

  return graph;
}

/// This expands globs found in the targetPaths
async function shimLinkPaths(
  targetPaths: string[],
  installPath: string,
  shimDir: string,
) {
  // map of filename to shimPath
  const shims: Record<string, string> = {};
  // a work sack to append to incase there are globs expanded
  const foundTargetPaths = [...targetPaths];
  while (foundTargetPaths.length > 0) {
    const file = foundTargetPaths.pop()!;
    if (std_path.isGlob(file)) {
      const glob = std_path.isAbsolute(file)
        ? file
        : std_path.joinGlobs([installPath, file], { extended: true });
      foundTargetPaths.push(
        ...(await Array.fromAsync(std_fs.expandGlob(glob)))
          .map((entry) => entry.path),
      );
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

/// Drive a port implementation so that it does its thing
async function doInstall(
  installsDir: string,
  downloadsDir: string,
  tmpDir: string,
  instUnclean: InstallConfigLite,
  manifest: PortManifestX,
  depArts: DepArts,
) {
  logger().debug("installing", {
    installsDir,
    downloadsDir,
    instUnclean,
    port: manifest,
  });

  // instantiate the right Port impl according to manifest.ty
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
  } else {
    throw new Error(
      `unsupported plugin type "${(manifest as unknown as any).ty}": ${
        $.inspect(manifest)
      }`,
    );
  }

  const installId = await getInstallHash(inst);
  const installVersion = validators.string.parse(
    inst.version ??
      await port.latestStable({
        depArts,
        manifest,
        config: inst,
      }),
  );
  const installPath = std_path.resolve(installsDir, installId);
  const downloadPath = std_path.resolve(downloadsDir, installId);
  const baseArgs: PortArgsBase = {
    installPath: installPath,
    installVersion: installVersion,
    depArts,
    platform: Deno.build,
    config: inst,
    manifest,
  };
  {
    logger().info(`downloading ${installId}:${installVersion}`);
    const tmpDirPath = await Deno.makeTempDir({
      dir: tmpDir,
      prefix: `download_${installId}@${installVersion}_`,
    });
    await port.download({
      ...baseArgs,
      downloadPath: downloadPath,
      tmpDirPath,
    });
    void $.removeIfExists(tmpDirPath);
  }
  {
    logger().info(`installing ${installId}:${installVersion}`);
    const tmpDirPath = await Deno.makeTempDir({
      dir: tmpDir,
      prefix: `install_${installId}@${installVersion}_`,
    });
    await port.install({
      ...baseArgs,
      availConcurrency: AVAIL_CONCURRENCY,
      downloadPath: downloadPath,
      tmpDirPath,
    });
    void $.removeIfExists(tmpDirPath);
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
