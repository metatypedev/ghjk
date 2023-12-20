//! This module is intended to be re-exported by `ghjk.ts` config scripts. Please
//! avoid importing elsewhere at it has side-effects.

// TODO: harden most of the items in here

import "./setup_logger.ts";

import portsValidators from "./modules/ports/types.ts";
import type {
  AllowedPortDep,
  InstallConfigFat,
  PortsModuleConfig,
  PortsModuleConfigBase,
  PortsModuleSecureConfig,
} from "./modules/ports/types.ts";
import type { SerializedConfig } from "./host/types.ts";
import logger from "./utils/logger.ts";
import { $ } from "./utils/mod.ts";
import * as std_ports from "./modules/ports/std.ts";
import * as cpy from "./ports/cpy_bs.ts";
import * as node from "./ports/node.ts";
import { std_modules } from "./modules/mod.ts";

const portsConfig: PortsModuleConfigBase = { installs: [] };

// freeze the object to prevent malicious tampering of the secureConfig
export const ghjk = Object.freeze({
  getConfig: Object.freeze(getConfig),
});

export { $, install, logger, secureConfig, stdDeps };

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

function secureConfig(
  config: PortsModuleSecureConfig,
) {
  return config;
}

function stdDeps(args = { enableRuntimes: false }) {
  const out: AllowedPortDep[] = [
    ...Object.values(std_ports.map),
  ];
  if (args.enableRuntimes) {
    out.push(
      ...[
        node.default(),
        cpy.default(),
      ].map((fatInst) => {
        const { port, ...liteInst } = fatInst;
        return portsValidators.allowedPortDep.parse({
          manifest: port,
          defaultInst: {
            portName: port.name,
            ...liteInst,
          },
        });
      }),
    );
  }
  return out;
}

function getConfig(secureConfig: PortsModuleSecureConfig | undefined) {
  try {
    const allowedDeps = Object.fromEntries([
      ...(secureConfig?.allowedPortDeps ?? stdDeps())
        .map((dep) =>
          [
            dep.manifest.name,
            portsValidators.allowedPortDep.parse(dep),
          ] as const
        ),
    ]);
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
  } catch (cause) {
    throw new Error(`error constructing config for serializatino`, { cause });
  }
}
