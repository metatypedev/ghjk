import { std_fs, std_path, zod } from "../../deps/cli.ts";
import logger from "../../utils/logger.ts";
import validators, {
  type AmbientAccessPortManifestX,
  type DenoWorkerPortManifestX,
  type DepShims,
  type InstallConfig,
  InstallConfigX,
  type PortArgsBase,
  type PortManifestX,
  type PortsModuleConfig,
} from "./types.ts";
import { DenoWorkerPort } from "./worker.ts";
import { AVAIL_CONCURRENCY, dirs } from "../../utils/cli.ts";
import { AmbientAccessPort } from "./ambient.ts";
import { AsdfPort } from "./asdf.ts";
import { getInstallId } from "../../utils/mod.ts";

async function findConfig(path: string): Promise<string | null> {
  let current = path;
  while (current !== "/") {
    const location = `${path}/ghjk.ts`;
    if (await std_fs.exists(location)) {
      return location;
    }
    current = std_path.dirname(current);
  }
  return null;
}

function envDirFromConfig(config: string): string {
  const { shareDir } = dirs();
  return std_path.resolve(
    shareDir,
    "envs",
    std_path.dirname(config).replaceAll("/", "."),
  );
}

async function writeLoader(envDir: string, env: Record<string, string>) {
  await Deno.mkdir(envDir, { recursive: true });
  await Deno.writeTextFile(
    `${envDir}/loader.fish`,
    Object.entries(env).map(([k, v]) =>
      `set --global --append GHJK_CLEANUP "set --global --export ${k} '$${k}';";\nset --global --export ${k} '${v}';`
    ).join("\n"),
  );
  await Deno.writeTextFile(
    `${envDir}/loader.sh`,
    `export GHJK_CLEANUP="";\n` +
      Object.entries(env).map(([k, v]) =>
        `GHJK_CLEANUP+="export ${k}='$${k}';";\nexport ${k}='${v}';`
      ).join("\n"),
  );
}

export async function sync(cx: PortsModuleConfig) {
  const config = await findConfig(Deno.cwd());
  if (!config) {
    logger().error("ghjk did not find any `ghjk.ts` config.");
    return;
  }
  logger().debug("syncing");

  const envDir = envDirFromConfig(config);
  logger().debug({ envDir });

  const installs = buildInstallGraph(cx);
  const artifacts = new Map<string, InstallArtifacts>();
  const pendingInstalls = [...installs.indie];
  while (pendingInstalls.length > 0) {
    const installId = pendingInstalls.pop()!;
    const inst = installs.all.get(installId)!;

    const manifest = cx.ports[inst.portName] ??
      cx.allowedDeps[inst.portName]!;
    const depShims: DepShims = {};

    // create the shims for the deps
    const depShimsRootPath = await Deno.makeTempDir({
      prefix: `ghjk_dep_shims_${installId}_`,
    });
    for (const depId of manifest.deps ?? []) {
      const depPort = cx.allowedDeps[depId.id]!;
      const depInstall = {
        portName: depPort.name,
      };
      const depInstallId = getInstallId(depInstall);
      const depArtifacts = artifacts.get(depInstallId);
      if (!depArtifacts) {
        throw new Error(
          `artifacts not found for plug dep "${depInstallId}" when installing "${installId}"`,
        );
      }
      const depShimDir = std_path.resolve(depShimsRootPath, depInstallId);
      await Deno.mkdir(depShimDir);
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
      thisArtifacts = await doInstall(envDir, inst, manifest, depShims);
    } catch (err) {
      throw new Error(`error installing ${installId}`, { cause: err });
    }
    artifacts.set(installId, thisArtifacts);
    void Deno.remove(depShimsRootPath, { recursive: true });

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

  const shimDir = std_path.resolve(envDir, "shims");
  if (await std_fs.exists(shimDir)) {
    await Deno.remove(shimDir, { recursive: true });
  }
  // create shims for the environment
  await Promise.allSettled([
    Deno.mkdir(std_path.resolve(shimDir, "bin"), { recursive: true }),
    Deno.mkdir(std_path.resolve(shimDir, "lib"), { recursive: true }),
    Deno.mkdir(std_path.resolve(shimDir, "include"), { recursive: true }),
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
      std_path.resolve(shimDir, "bin"),
    );
    // lib shims
    void await shimLinkPaths(
      libPaths,
      installPath,
      std_path.resolve(shimDir, "lib"),
    );
    // include shims
    void await shimLinkPaths(
      includePaths,
      installPath,
      std_path.resolve(shimDir, "include"),
    );
  }

  // write loader for the env vars mandated by the installs
  const env: Record<string, [string, string]> = {};
  for (const [instId, item] of artifacts) {
    for (const [key, val] of Object.entries(item.env)) {
      const conflict = env[key];
      if (conflict) {
        throw new Error(
          `duplicate env var found ${key} from installs ${instId} & ${
            conflict[1]
          }`,
        );
      }
      env[key] = [val, instId];
    }
  }
  // FIXME: prevent malicious env manipulations
  await writeLoader(
    envDir,
    Object.fromEntries(
      Object.entries(env).map(([key, [val, _]]) => [key, val]),
    ),
  );
}
function buildInstallGraph(cx: PortsModuleConfig) {
  const installs = {
    all: new Map<string, InstallConfig>(),
    indie: [] as string[],
    // edges from dependency to dependent
    revDepEdges: new Map<string, string[]>(),
    // edges from dependent to dependency
    depEdges: new Map<string, string[]>(),
    user: new Set<string>(),
  };
  const foundInstalls: InstallConfig[] = [];
  for (const inst of cx.installs) {
    const instId = getInstallId(inst);
    // FIXME: better support for multi installs
    if (installs.user.has(instId)) {
      throw new Error(`duplicate install found by plugin ${inst.portName}`);
    }
    installs.user.add(instId);
    foundInstalls.push(inst);
  }

  while (foundInstalls.length > 0) {
    const inst = foundInstalls.pop()!;
    const manifest = cx.ports[inst.portName] ??
      cx.allowedDeps[inst.portName];
    if (!manifest) {
      throw new Error(
        `unable to find plugin "${inst.portName}" specified by install ${
          JSON.stringify(inst)
        }`,
      );
    }
    const installId = getInstallId(inst);

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
        const depInstall = {
          portName: depPort.name,
        };
        const depInstallId = getInstallId(depInstall);

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
      await Deno.remove(shimPath);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
    await Deno.symlink(filePath, shimPath, { type: "file" });
    shims[fileName] = shimPath;
  }
  return shims;
}

type DePromisify<T> = T extends Promise<infer Inner> ? Inner : T;
type InstallArtifacts = DePromisify<ReturnType<typeof doInstall>>;

async function doInstall(
  envDir: string,
  instUnclean: InstallConfig,
  manifest: PortManifestX,
  depShims: DepShims,
) {
  logger().debug("installing", { envDir, instUnclean, port: manifest });
  let port;
  let inst: InstallConfigX;
  if (manifest.ty == "denoWorker") {
    inst = validators.installConfig.parse(instUnclean);
    port = new DenoWorkerPort(
      manifest as DenoWorkerPortManifestX,
    );
  } else if (manifest.ty == "ambientAccess") {
    inst = validators.installConfig.parse(instUnclean);
    port = new AmbientAccessPort(
      manifest as AmbientAccessPortManifestX,
    );
  } else if (manifest.ty == "asdf") {
    const asdfInst = validators.asdfInstallConfig.parse(instUnclean);
    inst = asdfInst;
    port = await AsdfPort.init(envDir, asdfInst, depShims);
  } else {
    throw new Error(
      `unsupported plugin type "${(manifest as unknown as any).ty}": ${
        JSON.stringify(manifest)
      }`,
    );
  }
  const installId = getInstallId(inst);
  const installVersion = validators.string.parse(
    inst.version ?? await port.latestStable({
      depShims,
    }),
  );
  const installPath = std_path.resolve(
    envDir,
    "installs",
    installId,
    installVersion,
  );
  const downloadPath = std_path.resolve(
    envDir,
    "downloads",
    installId,
    installVersion,
  );
  const baseArgs: PortArgsBase = {
    installPath: installPath,
    // installType: "version",
    installVersion: installVersion,
    depShims,
    platform: Deno.build,
    config: inst,
  };
  {
    logger().info(`downloading ${installId}:${installVersion}`);
    const tmpDirPath = await Deno.makeTempDir({
      prefix: `ghjk_download_${installId}:${installVersion}_`,
    });
    await port.download({
      ...baseArgs,
      downloadPath: downloadPath,
      tmpDirPath,
    });
    void Deno.remove(tmpDirPath, { recursive: true });
  }
  {
    logger().info(`installing ${installId}:${installVersion}`);
    const tmpDirPath = await Deno.makeTempDir({
      prefix: `ghjk_install_${installId}@${installVersion}_`,
    });
    await port.install({
      ...baseArgs,
      availConcurrency: AVAIL_CONCURRENCY,
      downloadPath: downloadPath,
      tmpDirPath,
    });
    void Deno.remove(tmpDirPath, { recursive: true });
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
