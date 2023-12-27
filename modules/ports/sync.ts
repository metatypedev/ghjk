import { equal, std_fs, std_path, zod } from "../../deps/cli.ts";
import getLogger from "../../utils/logger.ts";
import validators from "./types.ts";
import type {
  AmbientAccessPortManifestX,
  DenoWorkerPortManifestX,
  DepArts,
  DownloadArtifacts,
  InstallArtifacts,
  InstallConfigLite,
  InstallConfigLiteX,
  PortArgsBase,
  PortManifestX,
  PortsModuleConfigX,
} from "./types.ts";
import { DenoWorkerPort } from "./worker.ts";
import { AmbientAccessPort } from "./ambient.ts";
import {
  $,
  AVAIL_CONCURRENCY,
  DePromisify,
  getInstallHash,
  getPortRef,
} from "../../utils/mod.ts";
import type { InstallsDb } from "./db.ts";

const logger = getLogger(import.meta);

/*
 */
export async function installAndShimEnv(
  portsDir: string,
  envDir: string,
  installsDb: InstallsDb,
  graph: InstallGraph,
  createShellLoaders = true,
) {
  logger.debug("syncing ports");
  const installArts = await installAll(
    portsDir,
    installsDb,
    graph,
  );
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
  const totalEnv: Record<string, [string, string]> = {};
  // FIXME: detect shim conflicts
  // FIXME: better support for multi installs
  for (const instId of graph.user) {
    const { binPaths, libPaths, includePaths, installPath, env } = installArts
      .get(
        instId,
      )!;

    for (const [key, val] of Object.entries(env)) {
      const conflict = totalEnv[key];
      if (conflict) {
        throw new Error(
          `duplicate env var found ${key} from sources ${instId} & ${
            conflict[1]
          }`,
        );
      }
      totalEnv[key] = [val, instId];
    }

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
  logger.debug("adding vars to loader", totalEnv);
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
  // totalEnv contains info about the origin of the env
  // which we don't need anymore
  const simplifedTotalEnvs = Object.fromEntries(
    Object.entries(totalEnv).map(([key, [val, _]]) => [key, val]),
  );
  if (createShellLoaders) {
    await writeLoader(
      envDir,
      simplifedTotalEnvs,
      pathVars,
    );
  }
  return {
    env: {
      ...simplifedTotalEnvs,
      ...pathVars,
    },
  };
}

export async function installAll(
  portsDir: string,
  installsDb: InstallsDb,
  graph: InstallGraph,
) {
  const installCtx = {
    // the end artifacts of a port
    artifacts: new Map<string, InstallArtifacts>(),
    // a deep clone graph.depEdges for a list of deps for each port
    // to tick of as we work through the graph
    // initial graph.depEdges is needed intact for other purposes
    pendingDepEdges: new Map<string, [string, string][]>(
      Object.entries(graph.depEdges).map(([key, val]) => [key, [...val!]]),
    ),
    // make an object detailing all the artifacts
    // that the port's deps have exported
    async readyDepArts(
      tmpPath: string,
      installId: string,
    ) {
      const totalDepArts: DepArts = {};
      const depShimsRootPath = await Deno.makeTempDir({
        dir: tmpPath,
        prefix: `shims_${installId}_`,
      });
      for (
        const [depInstallId, depPortName] of graph.depEdges[installId] ?? []
      ) {
        const depArts = installCtx.artifacts.get(depInstallId);
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
      return { totalDepArts, depShimsRootPath };
    },

    installDone(installId: string) {
      // mark where appropriate if some other install was waiting on
      // the current install
      const parents = graph.revDepEdges[installId] ?? [];
      // list of parents that are ready for installation now
      // that their dep is fullfilled
      const readyParents = [];
      for (const parentId of parents) {
        const parentDeps = installCtx.pendingDepEdges.get(parentId)!;

        // swap remove from parent pending deps list
        const idx = parentDeps.findIndex(([instId, _]) => instId == installId);
        const last = parentDeps.pop()!;
        if (parentDeps.length > idx) {
          parentDeps[idx] = last;
        }

        if (parentDeps.length == 0) {
          // parent is ready for install
          readyParents.push(parentId);
        }
      }
      return readyParents;
    },
  };
  logger.debug("syncing ports");
  const portsPath = $.path(portsDir);
  // ensure the req
  const [installsPath, downloadsPath, tmpPath] = (
    await Promise.all([
      portsPath.join("installs").ensureDir(),
      portsPath.join("downloads").ensureDir(),
      movebleTmpRoot(portsDir),
    ])
  ).map($.pathToString);

  //  start from the ports with no build deps
  const pendingInstalls = [...graph.indie];
  while (pendingInstalls.length > 0) {
    const installId = pendingInstalls.pop()!;
    const cached = await installsDb.get(installId);

    let thisArtifacts;
    // we skip it if it's already installed
    if (cached && cached.progress == "installed") {
      logger.debug("already installed, skipping", installId);
      thisArtifacts = cached.installArts!;
    } else {
      const inst = graph.all[installId]!;

      const manifest = graph.ports[inst.portRef]!;

      // readys all the exports of the port's deps including
      // shims for their exports
      const { totalDepArts, depShimsRootPath } = await installCtx
        .readyDepArts(
          tmpPath,
          installId,
        );

      const stageArgs = {
        installId,
        installPath: std_path.resolve(installsPath, installId),
        downloadPath: std_path.resolve(downloadsPath, installId),
        tmpPath,
        conf: inst.conf,
        manifest,
        depArts: totalDepArts,
      };

      const dbRow = {
        installId,
        conf: inst.conf,
        manifest,
      };
      let downloadArts;
      if (cached) {
        logger.debug("already downloaded, skipping to install", installId);
        // download step must have completed if there's a cache hit
        downloadArts = cached.downloadArts;
      } else {
        try {
          downloadArts = await doDownloadStage({
            ...stageArgs,
          });
        } catch (err) {
          throw new Error(`error downloading ${installId}`, { cause: err });
        }
        await installsDb.set(installId, {
          ...dbRow,
          progress: "downloaded",
          downloadArts,
        });
      }

      try {
        thisArtifacts = await doInstallStage(
          {
            ...stageArgs,
            ...downloadArts,
          },
        );
      } catch (err) {
        throw new Error(`error installing ${installId}`, { cause: err });
      }
      await installsDb.set(installId, {
        ...dbRow,
        progress: "installed",
        downloadArts,
        installArts: thisArtifacts,
      });
      await $.removeIfExists(depShimsRootPath);
    }
    installCtx.artifacts.set(installId, thisArtifacts);
    pendingInstalls.push(...installCtx.installDone(installId));
  }
  await $.removeIfExists(tmpPath);
  return installCtx.artifacts;
}

/* *
 * This returns a tmp path that's guaranteed to be
 * on the same file system as targetDir by
 * checking if $TMPDIR satisfies that constraint
 * or just pointing to targetDir/tmp
 * This is handy for making moves atomics from
 * tmp dirs to to locations within targetDir
 *
 * Make sure to remove the dir after use
 */
async function movebleTmpRoot(targetDir: string, targetTmpDirName = "dir") {
  const defaultTmp = Deno.env.get("TMPDIR");
  const targetPath = $.path(targetDir);
  if (!defaultTmp) {
    // this doens't return a unique tmp dir on every sync
    // this allows subsequent syncs to clean up after
    // some previously failing sync as this is not a system managed
    // tmp dir but this means two concurrent syncing  will clash
    // TODO: mutex file to prevent block concurrent syncinc
    return await targetPath.join(targetTmpDirName).ensureDir();
  }
  const defaultTmpPath = $.path(defaultTmp);
  if ((await targetPath.stat())?.dev != (await defaultTmpPath.stat())?.dev) {
    return await targetPath.join(targetTmpDirName).ensureDir();
  }
  // when using the system managed tmp dir, we create a new tmp dir in it
  // we don't care if the sync fails before it cleans as the system will
  // take care of it
  return $.path(await Deno.makeTempDir({ prefix: "ghjk_sync" }));
}

export type InstallGraph = DePromisify<ReturnType<typeof buildInstallGraph>>;

// this returns a data structure containing all the info
// required for installation including the dependency graph
export async function buildInstallGraph(cx: PortsModuleConfigX) {
  type GraphInstConf = {
    portRef: string;
    conf: InstallConfigLite;
  };
  // this is all referring to port dependencies
  // TODO: runtime dependencies
  // NOTE: keep this easy to deserialize around as it's put directly
  // into the lockfile
  const graph = {
    // maps from instHashId
    all: {} as Record<string, GraphInstConf | undefined>,
    // list of installs specified by the user (excludes deps)
    user: [] as string[],
    // list of installs that don't have any dependencies
    indie: [] as string[],
    // maps allowed deps ids to their install hash
    allowed: {} as Record<string, string>,
    // edges from dependency to dependent
    revDepEdges: {} as Record<string, string[]>,
    // edges from dependent to dependency [depInstId, portName]
    depEdges: {} as Record<string, [string, string][] | undefined>,
    // the manifests of the ports
    ports: {} as Record<string, PortManifestX | undefined>,
  };
  function addPort(manifest: PortManifestX) {
    const portRef = `${manifest.name}@${manifest.version}`;

    const conflict = graph.ports[portRef];
    if (conflict) {
      if (!equal.equal(conflict, manifest)) {
        throw new Error(
          `differing port manifests found for "${portRef}: ${
            $.inspect(manifest)
          }" != ${$.inspect(conflict)}`,
        );
      }
    } else {
      graph.ports[portRef] = manifest;
    }

    return portRef;
  }
  // add port to ports list

  const foundInstalls: GraphInstConf[] = [];

  // collect the user specified insts first
  for (const inst of cx.installs) {
    const { port: manifest, ...instLiteBase } = inst;
    const portRef = addPort(manifest);
    const instLite = validators.installConfigLite.parse({
      ...instLiteBase,
      portRef: getPortRef(manifest),
    });
    // const port = getPortImpl(manifest);
    // const listAllArgs = {};
    // if (instLite.version) {
    //   port.listAll({})
    // } else {
    // }
    const instId = await getInstallHash(instLite);

    // no dupes allowed in user specified insts
    if (graph.user.includes(instId)) {
      throw new Error(
        `duplicate install found for port "${inst.port.name}": ${
          $.inspect(inst)
        }`,
      );
    }
    graph.user.push(instId);
    foundInstalls.push({ portRef, conf: instLite });
  }

  // process each port's dependency trees
  // starting from the user specified insts
  while (foundInstalls.length > 0) {
    const inst = foundInstalls.pop()!;

    const manifest = graph.ports[inst.portRef];
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
    const conflict = graph.all[installId];
    if (conflict) {
      continue;
    }

    graph.all[installId] = inst;

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
          const thisDeps = graph.revDepEdges[installId];
          if (thisDeps && thisDeps.includes(depInstallId)) {
            throw new Error(
              `cyclic dependency detected between "${installId}" and  "${depInstallId}"`,
            );
          }
        }

        // only add the install configuration for this dep port
        // if specific hash hasn't seen before
        if (!graph.all[depInstallId]) {
          const portRef = addPort(depPort);
          foundInstalls.push({ conf: depInstall, portRef });
        }

        deps.push([depInstallId, depPort.name]);

        // make sure the dependency knows this install depends on it
        const reverseDeps = graph.revDepEdges[depInstallId] ?? [];
        reverseDeps.push(installId);
        graph.revDepEdges[depInstallId] = reverseDeps;
      }
      graph.depEdges[installId] = deps;
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

// instantiates the right Port impl according to manifest.ty
export function getPortImpl(manifest: PortManifestX) {
  if (manifest.ty == "denoWorker@v1") {
    return new DenoWorkerPort(
      manifest as DenoWorkerPortManifestX,
    );
  } else if (manifest.ty == "ambientAccess@v1") {
    return new AmbientAccessPort(
      manifest as AmbientAccessPortManifestX,
    );
  } else {
    throw new Error(
      `unsupported plugin type "${(manifest as unknown as any).ty}": ${
        $.inspect(manifest)
      }`,
    );
  }
}

async function doDownloadStage(
  {
    installId,
    installPath,
    downloadPath,
    tmpPath,
    conf,
    manifest,
    depArts,
  }: {
    installId: string;
    installPath: string;
    downloadPath: string;
    tmpPath: string;
    conf: InstallConfigLiteX;
    manifest: PortManifestX;
    depArts: DepArts;
  },
) {
  logger.debug("downloading", {
    installId,
    installPath,
    downloadPath,
    conf,
    port: manifest,
  });

  const port = getPortImpl(manifest);

  const installVersion = validators.string.parse(
    conf.version ??
      await port.latestStable({
        depArts,
        manifest,
        config: conf,
      }),
  );

  logger.info(`downloading ${installId}:${installVersion}`);
  const tmpDirPath = await Deno.makeTempDir({
    dir: tmpPath,
    prefix: `download_${installId}@${installVersion}_`,
  });
  await port.download({
    installPath: installPath,
    installVersion: installVersion,
    depArts,
    platform: Deno.build,
    config: conf,
    manifest,
    downloadPath,
    tmpDirPath,
  });
  await $.removeIfExists(tmpDirPath);

  const out: DownloadArtifacts = {
    downloadPath,
    installVersion,
  };
  return out;
}

async function doInstallStage(
  {
    installId,
    installPath,
    downloadPath,
    tmpPath,
    conf,
    manifest,
    depArts,
    installVersion,
  }: {
    installId: string;
    installPath: string;
    downloadPath: string;
    tmpPath: string;
    conf: InstallConfigLite;
    manifest: PortManifestX;
    depArts: DepArts;
    installVersion: string;
  },
) {
  logger.debug("installing", {
    installId,
    installPath,
    downloadPath,
    conf,
    port: manifest,
  });

  const port = getPortImpl(manifest);

  const baseArgs: PortArgsBase = {
    installPath,
    installVersion,
    depArts,
    platform: Deno.build,
    config: conf,
    manifest,
  };
  logger.debug("baseArgs", installId, baseArgs);

  {
    logger.info(`installing ${installId}:${installVersion}`);
    const tmpDirPath = await Deno.makeTempDir({
      dir: tmpPath,
      prefix: `install_${installId}@${installVersion}_`,
    });
    await port.install({
      ...baseArgs,
      availConcurrency: AVAIL_CONCURRENCY,
      downloadPath: downloadPath,
      tmpDirPath,
    });
    await $.removeIfExists(tmpDirPath);
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
  return {
    env,
    binPaths,
    libPaths,
    includePaths,
    installPath,
    downloadPath,
    installVersion,
  };
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
