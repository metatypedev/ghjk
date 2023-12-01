export * from "./types.ts";
import { semver } from "../../deps/common.ts";

import validators, {
  type AmbientAccessPortManifest,
  type DenoWorkerPortManifest,
  type GhjkConfig,
  type InstallConfig,
  type RegisteredPort,
} from "./types.ts";
import logger from "../../utils/logger.ts";

export const Ghjk = {
  cwd: Deno.cwd,
};

export function registerDenoPlug(
  cx: GhjkConfig,
  manifestUnclean: DenoWorkerPortManifest,
) {
  const manifest = validators.denoWorkerPortManifest.parse(manifestUnclean);
  registerPlug(cx, { ty: "denoWorker", manifest });
}

export function registerAmbientPlug(
  cx: GhjkConfig,
  manifestUnclean: AmbientAccessPortManifest,
) {
  const manifest = validators.ambientAccessPortManifest.parse(manifestUnclean);
  registerPlug(cx, { ty: "ambientAccess", manifest });
}

export function registerPlug(
  cx: GhjkConfig,
  plug: RegisteredPort,
) {
  const { manifest } = plug;
  const conflict = cx.ports.get(manifest.name)?.manifest;
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
      cx.ports.set(manifest.name, plug);
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
      cx.ports.set(manifest.name, plug);
    } else {
      logger().debug("plug rejected due after defer", {
        retained: conflict,
        rejected: manifest,
      });
    }
  } else {
    logger().debug("plug registered", manifest.name);
    cx.ports.set(manifest.name, plug);
  }
}

export function addInstall(
  cx: GhjkConfig,
  config: InstallConfig,
) {
  if (!cx.ports.has(config.portName)) {
    throw new Error(
      `unrecognized plug "${config.portName}" specified by install ${
        JSON.stringify(config)
      }`,
    );
  }
  logger().debug("install added", config);
  cx.installs.push(config);
}
