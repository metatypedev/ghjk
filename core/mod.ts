export * from "./types.ts";
export { default as validators } from "./validators.ts";
import { semver } from "../deps/common.ts";
import type {
  AmbientAccessPlugManifest,
  DenoWorkerPlugManifest,
  GhjkConfig,
  InstallConfig,
  RegisteredPlug,
} from "./types.ts";
import validators from "./validators.ts";
import logger from "./logger.ts";

export const Ghjk = {
  cwd: Deno.cwd,
};

export function registerDenoPlug(
  cx: GhjkConfig,
  manifestUnclean: DenoWorkerPlugManifest,
) {
  const manifest = validators.denoWorkerPlugManifest.parse(manifestUnclean);
  registerPlug(cx, { ty: "denoWorker", manifest });
}

export function registerAmbientPlug(
  cx: GhjkConfig,
  manifestUnclean: AmbientAccessPlugManifest,
) {
  const manifest = validators.ambientAccessPlugManifest.parse(manifestUnclean);
  registerPlug(cx, { ty: "ambientAccess", manifest });
}

export function registerPlug(
  cx: GhjkConfig,
  plug: RegisteredPlug,
) {
  const { manifest } = plug;
  const conflict = cx.plugs.get(manifest.name)?.manifest;
  if (conflict) {
    if (
      conflict.conflictResolution == "override" &&
      manifest.conflictResolution == "override"
    ) {
      throw new Error(
        `Two instances of plugin "${manifest.name}" found with ` +
          `both set to "${manifest.conflictResolution}" conflictResolution"`,
      );
    } else if (conflict.conflictResolution == "override") {
      logger().debug("plug rejected due to override", {
        retained: conflict,
        rejected: manifest,
      });
      // do nothing
    } else if (manifest.conflictResolution == "override") {
      logger().debug("plug override", {
        new: manifest,
        replaced: conflict,
      });
      cx.plugs.set(manifest.name, plug);
    } else if (
      semver.compare(
        semver.parse(manifest.version),
        semver.parse(conflict.version),
      ) == 0
    ) {
      throw new Error(
        `Two instances of the plug "${manifest.name}" found with an identical version` +
          `and both set to "deferToNewer" conflictResolution.`,
      );
    } else if (
      semver.compare(
        semver.parse(manifest.version),
        semver.parse(conflict.version),
      ) > 0
    ) {
      logger().debug("plug replaced after version defer", {
        new: manifest,
        replaced: conflict,
      });
      cx.plugs.set(manifest.name, plug);
    } else {
      logger().debug("plug rejected due after defer", {
        retained: conflict,
        rejected: manifest,
      });
    }
  } else {
    logger().debug("plug registered", manifest);
    cx.plugs.set(manifest.name, plug);
  }
}

export function addInstall(
  cx: GhjkConfig,
  config: InstallConfig,
) {
  if (!cx.plugs.has(config.plugName)) {
    throw new Error(
      `unrecognized plug "${config.plugName}" specified by install ${
        JSON.stringify(config)
      }`,
    );
  }
  logger().debug("install added", config);
  cx.installs.push(config);
}
