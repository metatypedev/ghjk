//! This module is intended to be re-exported by `ghjk.ts` config scripts. Please
//! avoid importing elsewhere at it has side-effects.

import "./setup_logger.ts";

import portsValidators, {
  type InstallConfigFat,
  type PortsModuleConfig,
  type PortsModuleConfigBase,
  type PortsModuleSecureConfig,
} from "./modules/ports/types.ts";
import type { SerializedConfig } from "./host/types.ts";
import logger from "./utils/logger.ts";
import { $ } from "./utils/mod.ts";
import * as std_ports from "./modules/ports/std.ts";
import { std_modules } from "./modules/mod.ts";

const portsConfig: PortsModuleConfigBase = { installs: [] };

// freeze the object to prevent malicious tampering of the secureConfig
export const ghjk = Object.freeze({
  getConfig: Object.freeze(getConfig),
});

export { $, install, logger };

function install(...configs: InstallConfigFat[]) {
  const cx = portsConfig;
  for (const config of configs) {
    addInstall(cx, config);
  }
}

function addInstall(
  cx: PortsModuleConfigBase,
  configUnclean: InstallConfigFat,
) {
  const config = portsValidators.installConfigFat.parse(configUnclean);
  logger().debug("install added", config);
  cx.installs.push(config);
}

function getConfig(secureConfig: PortsModuleSecureConfig | undefined) {
  let allowedDeps;
  if (secureConfig?.allowedPortDeps) {
    allowedDeps = Object.fromEntries([
      ...secureConfig.allowedPortDeps.map((dep) =>
        [dep.manifest.name, dep] as const
      ),
    ]);
  } else {
    allowedDeps = std_ports.map;
  }
  const fullPortsConfig: PortsModuleConfig = {
    installs: portsConfig.installs,
    allowedDeps: allowedDeps,
  };
  const config: SerializedConfig = {
    modules: [{
      id: std_modules.ports,
      config: fullPortsConfig,
    }],
  };
  return config;
}
