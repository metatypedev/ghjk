// File is slated to be re-written
// deno-lint-ignore-file no-await-in-loop

import { deep_eql, std_fs, std_path, zod } from "./deps.ts";
import getLogger from "../../deno_utils/logger.ts";
import validators from "./types.ts";
import type {
  AllowedPortDep,
  AmbientAccessPortManifest,
  DenoWorkerPortManifest,
  DepArts,
  DownloadArtifacts,
  InstallArtifacts,
  InstallConfigLite,
  InstallConfigResolved,
  InstallSet,
  PortArgsBase,
  PortDep,
  PortManifest,
} from "./types.ts";
import { getInstallHash, getPortRef } from "./types.ts";
import { DenoWorkerPort } from "./worker.ts";
import { AmbientAccessPort } from "../../deno_ports/ambient.ts";
import {
  $,
  AVAIL_CONCURRENCY,
  objectHash,
  type Rc,
  rc,
  sameFsTmpRoot,
} from "../../deno_utils/mod.ts";
import { type InstallsDb, installsDbKv } from "./db.ts";
import type { GhjkCtx } from "../types.ts";

const logger = getLogger(import.meta);

export type ResolutionMemoStore = Map<string, Promise<InstallConfigResolved>>;

export function getResolutionMemo(
  gcx: GhjkCtx,
) {
  const id = "resolutionMemoStore";
  let memoStore = gcx.blackboard.get(id) as
    | ResolutionMemoStore
    | undefined;
  if (!memoStore) {
    memoStore = new Map();
    gcx.blackboard.set(id, memoStore);
  }
  return memoStore;
}

export type SyncCtx = Awaited<ReturnType<typeof syncCtxFromGhjk>>;

export async function syncCtxFromGhjk(
  gcx: GhjkCtx,
) {
  const portsPath = await $.path(gcx.ghjkDataDir).resolve("ports")
    .ensureDir();
  const [installsPath, downloadsPath, tmpPath] = (
    await Promise.all([
      portsPath.join("installs").ensureDir(),
      portsPath.join("downloads").ensureDir(),
      sameFsTmpRoot(portsPath.toString()),
    ])
  ).map($.pathToString);
  let db = gcx.blackboard.get("installsDb") as
    | Rc<InstallsDb>
    | undefined;
  if (!db) {
    // db needs to be closed when done
    // so put it behind a reference counter
    db = rc(
      await installsDbKv(
        portsPath.resolve("installs.db").toString(),
      ),
      (db) => {
        db[Symbol.dispose]();
        gcx.blackboard.delete("installsDb");
      },
    );
    gcx.blackboard.set("installsDb", db);
  } else {
    db = db.clone();
  }
  const memoStore = getResolutionMemo(gcx);
  return {
    db,
    installsPath,
    downloadsPath,
    tmpPath,
    memoStore,
    async [Symbol.asyncDispose]() {
      db![Symbol.dispose]();
      await $.removeIfExists(tmpPath);
    },
  };
}

export async function installFromGraph(
  scx: SyncCtx,
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
        // NOTE : add whitespace to prefix to flush out whitespace path bugs
        prefix: `ws shims_${installId}_`,
      });
      await Promise.all((graph.depEdges[installId] ?? []).map(async (
        [depInstallId, depPortName],
      ) => {
        const depArts = installCtx.artifacts.get(depInstallId);
        if (!depArts) {
          throw new Error(
            `artifacts not found for port dep "${depInstallId}" when installing "${installId}"`,
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
      }));
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
          installCtx.pendingDepEdges.delete(parentId);
          // parent is ready for install
          readyParents.push(parentId);
        }
      }
      return readyParents;
    },
  };

  //  start from the ports with no build deps
  const pendingInstalls = [...graph.indie];
  while (pendingInstalls.length > 0) {
    const installId = pendingInstalls.pop()!;
    const cached = await scx.db.val.get(installId);

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
          scx.tmpPath,
          installId,
        );

      const stageArgs = {
        installId,
        installPath: std_path.resolve(scx.installsPath, installId),
        downloadPath: std_path.resolve(scx.downloadsPath, installId),
        tmpPath: scx.tmpPath,
        config: inst.config,
        manifest,
        depArts: totalDepArts,
      };

      const dbRow = {
        installId,
        conf: inst.config,
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
        await scx.db.val.set(installId, {
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
      await scx.db.val.set(installId, {
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
  if (installCtx.pendingDepEdges.size > 0) {
    throw Error(
      "something went wrong, install graph working graph is not empty",
    );
  }
  return installCtx.artifacts;
}

export type InstallGraph = Awaited<ReturnType<typeof buildInstallGraph>>;

// this returns a data structure containing all the info
// required for installation including the dependency graph
export async function buildInstallGraph(
  scx: SyncCtx,
  set: InstallSet,
) {
  type GraphInstConf = {
    instId: string;
    portRef: string;
    config: InstallConfigResolved;
  };
  // this is all referring to port dependencies
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
    ports: {} as Record<string, PortManifest | undefined>,
  };
  function addPort(manifest: PortManifest) {
    const portRef = `${manifest.name}@${manifest.version}`;

    const conflict = graph.ports[portRef];
    if (conflict) {
      if (!deep_eql(conflict, manifest)) {
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
  for (const inst of set.installs) {
    const { port: manifest, ...instLiteBase } = inst;
    const portRef = addPort(manifest);
    const instLite = validators.installConfigLite.parse({
      ...instLiteBase,
      portRef: getPortRef(manifest),
    });
    const resolvedConfig = await resolveConfig(
      scx,
      set.allowedBuildDeps,
      manifest,
      instLite,
    );
    const instId = getInstallHash(resolvedConfig);

    // no dupes allowed in user specified insts
    if (graph.user.includes(instId)) {
      throw new Error(
        `duplicate install found for port "${inst.port.name}": ${
          $.inspect(inst)
        }`,
      );
    }
    graph.user.push(instId);
    foundInstalls.push({ instId, portRef, config: resolvedConfig });
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

    const installId = inst.instId;
    // there might be multiple instances of an install at this point
    // due to a single install being a dependency to multiple others
    const conflict = graph.all[installId];
    if (conflict) {
      continue;
    }

    graph.all[installId] = inst;

    if (!manifest.buildDeps || manifest.buildDeps.length == 0) {
      graph.indie.push(installId);
    } else {
      // this goes into graph.depEdges
      const deps: [string, string][] = [];
      for (const depId of manifest.buildDeps) {
        const dep = set.allowedBuildDeps[depId.name];
        if (!dep) {
          throw new Error(
            `unrecognized dependency "${depId.name}" specified by port "${manifest.name}@${manifest.version}"`,
          );
        }
        const portRef = addPort(dep.manifest);

        // get the install config of dependency
        // the conf is of the resolved kind which means
        // it's deps are also resolved
        const depInstall = validators.installConfigResolved.parse(
          inst.config.buildDepConfigs![depId.name],
        );
        const depInstallId = getInstallHash(depInstall);

        // only add the install configuration for this dep port
        // if specific hash hasn't seen before
        if (!graph.all[depInstallId]) {
          foundInstalls.push({
            config: depInstall,
            portRef,
            instId: depInstallId,
          });
        }

        deps.push([depInstallId, dep.manifest.name]);

        // make sure the dependency knows this install depends on it
        const reverseDeps = graph.revDepEdges[depInstallId] ?? [];
        reverseDeps.push(installId);
        graph.revDepEdges[depInstallId] = reverseDeps;
      }
      graph.depEdges[installId] = deps;
    }
  }
  // check for cycles
  const testCycle = (
    instId: string,
    depInstId: string,
  ): GraphInstConf | undefined => {
    const depDeps = graph.depEdges[depInstId] ?? [];
    if (depDeps.some(([depInstId, _]) => depInstId == instId)) {
      return graph.all[depInstId];
    }
    for (const [depDep, _] of depDeps) {
      const hit = testCycle(instId, depDep);
      if (hit) return hit;
    }
  };
  for (const [instId, deps] of Object.entries(graph.depEdges)) {
    for (const [depId, _] of deps!) {
      const cycleCause = testCycle(instId, depId);
      if (cycleCause) {
        throw new Error(
          `cyclic dependency detected`,
          {
            cause: {
              inst: graph.all[instId],
              cycleCause,
            },
          },
        );
      }
    }
  }

  return graph;
}

// This takes user specified InstallConfigs and resolves
// their versions to a known, installable version
// It also resolves any dependencies that the config specifies
function resolveConfig(
  scx: SyncCtx,
  allowedDeps: Record<string, AllowedPortDep>,
  manifest: PortManifest,
  config: InstallConfigLite,
) {
  const hash = objectHash(JSON.parse(JSON.stringify(config)));
  let promise = scx.memoStore.get(hash);
  if (!promise) {
    promise = inner();
    scx.memoStore.set(hash, promise);
  }
  return promise;
  async function inner() {
    // resolve and install the resolutionDeps first so that we
    // can invoke listAll and latestStable
    const resolvedResolutionDeps = [] as [string, string][];
    for (const dep of manifest.resolutionDeps ?? []) {
      const { manifest: depMan, config: depConf } = getDepConfig(
        allowedDeps,
        manifest,
        config,
        dep,
        true,
      );

      // get the version resolved config of the dependency
      const depInstId = await resolveAndInstall(
        scx,
        allowedDeps,
        depMan,
        depConf,
      );
      resolvedResolutionDeps.push([depInstId.installId, depMan.name]);
    }

    const depShimsRootPath = await Deno.makeTempDir({
      dir: scx.tmpPath,
      // NOTE : add whitespace to prefix to flush out whitespace path bugs
      prefix: `ws shims_resDeps_${manifest.name}_`,
    });
    const resolutionDepArts = await getShimmedDepArts(
      scx,
      depShimsRootPath,
      resolvedResolutionDeps,
    );

    // finally resolve the version
    let version;
    // TODO: fuzzy matching
    const port = getPortImpl(manifest);
    const listAllArgs = {
      depArts: resolutionDepArts,
      config,
      manifest,
    };
    if (config.version) {
      logger.info("resolving given version", config);
      const allVersions = await port.listAll(listAllArgs);
      // TODO: fuzzy matching
      const match = allVersions.find((version) =>
        version == config.version || version == `v` + config.version
      );
      if (!match) {
        throw new Error(
          `error resolving verison ${config.version}: not found, available versions: [${
            allVersions.join(", ")
          }]`,
          {
            cause: { config, manifest, allVersions },
          },
        );
      }
      version = match;
    } else {
      logger.info("resolving latest version", config);
      const latestStable = await port.latestStable(listAllArgs);
      version = latestStable;
    }
    await $.removeIfExists(depShimsRootPath);

    // now we resolve the remaning deps
    // TODO: port version dependent portDep resolution
    // e.g. use python-2.7 if foo is resolved to <1.0 or use
    // python-3.x if foo is resolved to >1.0
    const buildDepConfigs = {} as Record<string, InstallConfigResolved>;
    for (const dep of manifest.buildDeps ?? []) {
      const { manifest: depMan, config: depConf } = getDepConfig(
        allowedDeps,
        manifest,
        config,
        dep,
      );
      // get the version resolved config of the dependency
      const depInstall = await resolveConfig(
        scx,
        allowedDeps,
        depMan,
        depConf,
      );
      buildDepConfigs[dep.name] = depInstall;
    }

    return validators.installConfigResolved.parse({
      ...config,
      version,
      specifiedVersion: !!config.version,
      buildDepConfigs,
    });
  }
}

// This gets either the dependency InstallConfig as specified by
// config.depPorts[depId] or the default InstallConfig specified
// for the portsConfig.allowedDeps
// No version resolution takes place
export function getDepConfig(
  allowedBuildDeps: Record<string, AllowedPortDep>,
  manifest: PortManifest,
  config: InstallConfigLite,
  depId: PortDep,
  resolutionDep = false,
) {
  const dep = allowedBuildDeps[depId.name];
  if (!dep) {
    throw new Error(
      `unrecognized dependency "${depId.name}" specified by port "${manifest.name}@${manifest.version}"`,
    );
  }
  const { manifest: depPort, defaultInst: defaultDepInstall } = dep;
  // install configuration of an allowed dep port
  // can be overriden by dependent ports
  const res = validators.installConfigLite.safeParse(
    (resolutionDep ? config.resolutionDepConfigs : config.buildDepConfigs)
      ?.[depId.name] ?? defaultDepInstall,
  );
  if (!res.success) {
    throw new Error(
      `error parsing depConfig for "${depId.name}" as specified by install of "${manifest.name}": ${res.error}`,
      {
        cause: {
          config,
          manifest,
          zodErr: res.error,
        },
      },
    );
  }
  return { config: res.data, manifest: depPort };
}

/**
 * This is a simpler version of the graph based installer that
 * the rest of this module implements.
 * It resolves and installs a single config (and its deps).
 * This primarily is used to install the manifest.resolutionDeps
 * which are required to do version resolution when building the
 * main graphs.
 */
// FIXME: the usage of this function implies that resolution
// will be redone if a config specfied by different resolutionDeps
// TODO: consider introducing a memoization scheme
export async function resolveAndInstall(
  scx: SyncCtx,
  allowedDeps: Record<string, AllowedPortDep>,
  manifest: PortManifest,
  configLite: InstallConfigLite,
) {
  const config = await resolveConfig(scx, allowedDeps, manifest, configLite);
  const installId = getInstallHash(config);

  const cached = await scx.db.val.get(installId);
  // we skip it if it's already installed
  if (cached && cached.progress == "installed") {
    logger.debug("already installed, skipping", installId);
  } else {
    const depShimsRootPath = await Deno.makeTempDir({
      dir: scx.tmpPath,
      // NOTE : add whitespace to prefix to flush out whitespace path bugs
      prefix: `ws shims_${installId}`,
    });
    // readies all the exports of the port's deps including
    // shims for their exports
    const totalDepArts = await getShimmedDepArts(
      scx,
      depShimsRootPath,
      await Promise.all(
        manifest.buildDeps?.map(
          async (dep) => {
            const depConfig = getDepConfig(allowedDeps, manifest, config, dep);
            // we not only resolve but install the dep here
            const { installId } = await resolveAndInstall(
              scx,
              allowedDeps,
              depConfig.manifest,
              depConfig.config,
            );
            return [installId, dep.name];
          },
        ) ?? [],
      ),
    );

    const stageArgs = {
      installId,
      installPath: std_path.resolve(scx.installsPath, installId),
      downloadPath: std_path.resolve(scx.downloadsPath, installId),
      tmpPath: scx.tmpPath,
      config: config,
      manifest,
      depArts: totalDepArts,
    };

    const dbRow = {
      installId,
      conf: config,
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
      await scx.db.val.set(installId, {
        ...dbRow,
        progress: "downloaded",
        downloadArts,
      });
    }

    let installArtifacts;
    try {
      installArtifacts = await doInstallStage(
        {
          ...stageArgs,
          ...downloadArts,
        },
      );
    } catch (err) {
      throw new Error(`error installing ${installId}`, { cause: err });
    }
    await scx.db.val.set(installId, {
      ...dbRow,
      progress: "installed",
      downloadArts,
      installArts: installArtifacts,
    });
    await $.removeIfExists(depShimsRootPath);
  }
  return { installId, config };
}

// This assumes that the installs are already in the db
export async function getShimmedDepArts(
  scx: SyncCtx,
  shimsRootPath: string,
  installs: [string, string][],
) {
  const totalDepArts: DepArts = {};
  await Promise.all(
    installs
      .map(
        async ([installId, portName]) => {
          const installRow = await scx.db.val.get(installId);
          if (!installRow || !installRow.installArts) {
            throw new Error(
              `artifacts not found for "${installId}" not found in db when shimming totalDepArts`,
              {
                cause: { installs },
              },
            );
          }
          const installArts = installRow.installArts;
          const shimDir = $.path(shimsRootPath).resolve(installId);
          const [binShimDir, libShimDir, includeShimDir] = (await Promise.all([
            shimDir.join("bin").ensureDir(),
            shimDir.join("lib").ensureDir(),
            shimDir.join("include").ensureDir(),
          ])).map($.pathToString);

          totalDepArts[portName] = {
            execs: await shimLinkPaths(
              installArts.binPaths,
              installArts.installPath,
              binShimDir,
            ),
            libs: await shimLinkPaths(
              installArts.libPaths,
              installArts.installPath,
              libShimDir,
            ),
            includes: await shimLinkPaths(
              installArts.includePaths,
              installArts.installPath,
              includeShimDir,
            ),
            env: installArts.env,
          };
        },
      ),
  );
  return totalDepArts;
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
    const fileName = std_path.basename(filePath); // TODO: #71 aliases
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
    await $.path(shimPath).symlinkTo(filePath, { type: "file" });
    shims[fileName] = shimPath;
  }
  return shims;
}

// instantiates the right Port impl according to manifest.ty
export function getPortImpl(manifest: PortManifest) {
  if (manifest.ty == "denoWorker@v1") {
    return new DenoWorkerPort(
      manifest as DenoWorkerPortManifest,
    );
  } else if (manifest.ty == "ambientAccess@v1") {
    return new AmbientAccessPort(
      manifest as AmbientAccessPortManifest,
    );
  } else {
    throw new Error(
      `unsupported port type "${(manifest as unknown as any).ty}": ${
        $.inspect(manifest)
      }`,
    );
  }
}

type DownloadStageArgs = {
  installId: string;
  installPath: string;
  downloadPath: string;
  tmpPath: string;
  config: InstallConfigResolved;
  manifest: PortManifest;
  depArts: DepArts;
};

export async function doDownloadStage(
  {
    installId,
    installPath,
    downloadPath,
    tmpPath,
    config,
    manifest,
    depArts,
  }: DownloadStageArgs,
) {
  logger.debug("downloading", {
    installId,
    installPath,
    downloadPath,
    config,
    port: manifest,
  });

  const port = getPortImpl(manifest);

  const installVersion = config.version;

  logger.info(`downloading ${installId}:${installVersion}`);
  const tmpDirPath = await Deno.makeTempDir({
    dir: tmpPath,
    // NOTE : add whitespace to prefix to flush out whitespace path bugs
    prefix: `ws download_${installId}@${installVersion}_`,
  });
  await port.download({
    installPath: installPath,
    installVersion: installVersion,
    depArts,
    platform: Deno.build,
    config: config,
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

type InstallStageArgs = DownloadStageArgs;

export async function doInstallStage(
  {
    installId,
    installPath,
    downloadPath,
    tmpPath,
    config,
    manifest,
    depArts,
  }: InstallStageArgs,
) {
  logger.debug("installing", {
    installId,
    installPath,
    downloadPath,
    config,
    port: manifest,
  });

  const port = getPortImpl(manifest);

  const installVersion = config.version;
  const baseArgs: PortArgsBase = {
    installPath,
    installVersion,
    depArts,
    platform: Deno.build,
    config: config,
    manifest,
  };
  {
    logger.info(`installing ${installId}:${installVersion}`);
    const tmpDirPath = await Deno.makeTempDir({
      dir: tmpPath,
      // NOTE : add whitespace to prefix to flush out whitespace path bugs
      prefix: `ws install_${installId}@${installVersion}_`,
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
