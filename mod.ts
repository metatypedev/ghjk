//! This module is intended to be re-exported by `ghjk.ts` config scripts. Please
//! avoid importing elsewhere at it has side-effects.

import "./setup_logger.ts";

import { semver } from "./deps/common.ts";
import portsValidators, {
  type InstallConfigFat,
  type InstallConfigLite,
  type PortManifest,
  type PortsModuleConfigBase,
  type PortsModuleSecureConfig,
  type RegisteredPorts,
} from "./modules/ports/types.ts";
import type { SerializedConfig } from "./host/types.ts";
import logger from "./utils/logger.ts";
import { $ } from "./utils/mod.ts";
import * as std_ports from "./modules/ports/std.ts";
import { std_modules } from "./modules/mod.ts";

const portsConfig: PortsModuleConfigBase = { ports: {}, installs: [] };
function getConfig(secureConfig: PortsModuleSecureConfig | undefined) {
  let allowedDeps;
  if (secureConfig?.allowedPortDeps) {
    allowedDeps = {} as RegisteredPorts;
    for (const depId of secureConfig.allowedPortDeps) {
      const regPort = std_ports.map[depId.id];
      if (!regPort) {
        throw new Error(
          `unrecognized dep "${depId.id}" found in "allowedPluginDeps"`,
        );
      }
      allowedDeps[depId.id] = regPort;
    }
  } else {
    allowedDeps = std_ports.map;
  }
  const config: SerializedConfig = {
    modules: [{
      id: std_modules.ports,
      config: {
        installs: portsConfig.installs,
        ports: portsConfig.ports,
        allowedDeps: allowedDeps,
      },
    }],
  };
  return config;
}

// freeze the object to prevent malicious tampering of the secureConfig
export const ghjk = Object.freeze({
  getConfig: Object.freeze(getConfig),
});

export { $, logger };

export function install(...configs: (InstallConfigFat | InstallConfigLite)[]) {
  const cx = portsConfig;
  for (const config of configs) {
    if ("portId" in config) {
      addInstall(cx, config as InstallConfigLite);
    } else {
      const {
        port,
        ...liteConfig
      } = config;
      const portId = registerPort(cx, port);
      addInstall(cx, { ...liteConfig, portId });
    }
  }
}

export function port(...manifests: PortManifest[]) {
  const cx = portsConfig;
  for (const man of manifests) {
    registerPort(cx, man);
  }
}

function addInstall(
  cx: PortsModuleConfigBase,
  configUnclean: InstallConfigLite,
) {
  const config = portsValidators.installConfigLite.parse(configUnclean);
  if (!cx.ports[config.portId]) {
    throw new Error(
      `unrecognized port "${config.portId}" specified by install ${
        JSON.stringify(config)
      }`,
    );
  }
  logger().debug("install added", config);
  cx.installs.push(config);
}

function registerPort(
  cx: PortsModuleConfigBase,
  manUnclean: PortManifest,
) {
  const manifest = portsValidators.portManifest.parse(manUnclean);
  const id = manifest.name;
  const conflict = cx.ports[id];
  if (conflict) {
    if (
      conflict.conflictResolution == "override" &&
      manifest.conflictResolution == "override"
    ) {
      if (
        semver.compare(
          semver.parse(manifest.version),
          semver.parse(conflict.version),
        ) != 0
      ) {
        throw new Error(
          `Two instances of port "${id}" found with different versions and` +
            `both set to "${manifest.conflictResolution}" conflictResolution"`,
        );
      } else {
        logger().debug(
          "port rejected due to dual override and equal versions",
          {
            retained: conflict,
            rejected: manifest,
          },
        );
      }
    } else if (conflict.conflictResolution == "override") {
      logger().debug("port rejected due to override", {
        retained: conflict,
        rejected: manifest,
      });
      // do nothing
    } else if (manifest.conflictResolution == "override") {
      logger().debug("port override", {
        new: manifest,
        replaced: conflict,
      });
      cx.ports[id] = manifest;
    } else if (
      semver.compare(
        semver.parse(manifest.version),
        semver.parse(conflict.version),
      ) == 0
    ) {
      throw new Error(
        `Two instances of the port "${id}" found with an identical version` +
          `and both set to "deferToNewer" conflictResolution.`,
      );
    } else if (
      semver.compare(
        semver.parse(manifest.version),
        semver.parse(conflict.version),
      ) > 0
    ) {
      logger().debug("port replaced after version defer", {
        new: manifest,
        replaced: conflict,
      });
      cx.ports[id] = manifest;
    } else {
      logger().debug("port rejected due after defer", {
        retained: conflict,
        rejected: manifest,
      });
    }
  } else {
    logger().debug("port registered", manifest.name);
    cx.ports[id] = manifest;
  }
  return id;
}
