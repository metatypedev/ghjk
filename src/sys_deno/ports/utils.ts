import { std_path } from "./deps.ts";
import logger from "../../deno_utils/logger.ts";
import { $ } from "../../deno_utils/mod.ts";
import { GhjkCtx } from "../types.ts";
import { AllowedPortDep } from "./mod.ts";
import {
  doDownloadStage,
  doInstallStage,
  getDepConfig,
  getShimmedDepArts,
  resolveAndInstall,
  SyncCtx,
  syncCtxFromGhjk,
} from "./sync.ts";
import { InstallConfigResolvedX, PortManifestX } from "./types.ts";

export async function updateInstall(
  gcx: GhjkCtx,
  installId: string,
  newVersion: string,
  allowedDeps: Record<string, AllowedPortDep>,
) {
  await using scx = await syncCtxFromGhjk(gcx);

  const db = scx.db.val;

  const install = await db.get(installId);

  if (!install) {
    throw new Error("InstallSetId not found in InstallsDb", {
      cause: {
        installId,
      },
    });
  }

  const config = install.conf;

  if (config.version === newVersion) {
    logger().info("Skipping update. Install is already uptodate");
    return;
  }

  // it's a user specified install, so skip
  if (config.specifiedVersion) {
    logger().info(`Skipping Version Specified Install: ${installId}`);
    return;
  }

  config.version = newVersion;
  logger().info(`Updating installId ${installId} to version ${newVersion}...`);
  await doInstall(installId, scx, install.manifest, allowedDeps, config);
  logger().info(
    `Successfully updated installId ${installId} to version ${newVersion}`,
  );
}

async function doInstall(
  installId: string,
  scx: SyncCtx,
  manifest: PortManifestX,
  allowedDeps: Record<string, AllowedPortDep>,
  config: InstallConfigResolvedX,
) {
  const depShimsRootPath = await Deno.makeTempDir({
    dir: scx.tmpPath,
    prefix: `shims_${installId}`,
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
