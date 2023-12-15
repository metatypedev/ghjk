//! This module is intended to be re-exported by `ghjk.ts` config scripts. Please
//! avoid importing elsewhere at it has side-effects.

import "./setup_logger.ts";

import {
  type PortsModuleConfigBase,
  type PortsModuleSecureConfig,
  type RegisteredPorts,
} from "./modules/ports/types.ts";
import type { SerializedConfig } from "./host/types.ts";
import logger from "./utils/logger.ts";
import { $ } from "./utils/mod.ts";
import * as std_ports from "./modules/ports/std.ts";
import { std_modules } from "./modules/mod.ts";

// we need to use global variables to allow
// pots to access the config object.
// accessing it through ecma module imports wouldn't work
//  as ports might import a different version of this module.
declare global {
  interface Window {
    ports: PortsModuleConfigBase;
  }
}

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
        installs: self.ports.installs,
        ports: self.ports.ports,
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
