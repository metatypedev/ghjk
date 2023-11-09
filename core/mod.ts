export * from "./types.ts";
import { semver } from "../deps/common.ts";
import {
  type GhjkCtx,
  type InstallConfig,
  type PlugManifest,
} from "./types.ts";
import validators from "./validators.ts";
import logger from "./logger.ts";

export function registerPlug(
  cx: GhjkCtx,
  manifestUnclean: PlugManifest,
) {
  const manifest = validators.plugManifestBase.parse(manifestUnclean);
  const conflict = cx.plugs.get(manifest.name);
  if (conflict) {
    if (
      conflict.conflictResolution == "override" &&
      manifest.conflictResolution == "override"
    ) {
      throw Error(
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
      cx.plugs.set(manifest.name, manifest);
    } else if (
      semver.compare(manifest.version, conflict.version) == 0
    ) {
      throw Error(
        `Two instances of the plug "${manifest.name}" found with an identical version` +
          `and bothboth set to "deferToNewer" conflictResolution.`,
      );
    } else if (
      semver.compare(manifest.version, conflict.version) > 0
    ) {
      logger().debug("plug replaced after version defer", {
        new: manifest,
        replaced: conflict,
      });
      cx.plugs.set(manifest.name, manifest);
    } else {
      logger().debug("plug rejected due after defer", {
        retained: conflict,
        rejected: manifest,
      });
    }
  } else {
    logger().debug("plug registered", manifest);
    cx.plugs.set(manifest.name, manifest);
  }
}

export function addInstall(
  cx: GhjkCtx,
  config: InstallConfig,
) {
  if (!cx.plugs.has(config.plugName)) {
    throw Error(
      `unrecognized plug "${config.plugName}" specified by install ${
        JSON.stringify(config)
      }`,
    );
  }
  logger().debug("install added", config);
  cx.installs.push(config);
}
