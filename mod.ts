//! This module is intended to be re-exported by `ghjk.ts` config scripts. Please
//! avoid importing elsewhere at it has side-effects.

// TODO: harden most of the items in here

import "./setup_logger.ts";

// ports specific imports
import portsValidators from "./modules/ports/types.ts";
import type {
  AllowedPortDep,
  InstallConfigFat,
  PortsModuleConfig,
  PortsModuleConfigBase,
  PortsModuleSecureConfig,
} from "./modules/ports/types.ts";
import logger from "./utils/logger.ts";
import { $ } from "./utils/mod.ts";
import * as std_ports from "./modules/ports/std.ts";
import * as cpy from "./ports/cpy_bs.ts";
import * as node from "./ports/node.ts";
// hosts
import type { SerializedConfig } from "./host/types.ts";
import * as std_modules from "./modules/std.ts";
// tasks
import type { TasksModuleConfig } from "./modules/tasks/types.ts";
import { zcli } from "./deps/common.ts";
import { cliffy_cmd } from "./deps/cli.ts";

const portsConfig: PortsModuleConfigBase = { installs: [] };
const taskCtx = {
  meta: { version: "now" },
  $,
};
export type TasksZcliCtx = typeof taskCtx;

const tasks = {
  comands: {} as Record<
    string,
    zcli.Command<zcli.DefaultContext & TasksZcliCtx>
  >,
  climands: {} as Record<
    string,
    cliffy_cmd.Command
  >,
};

const tasksCli = zcli.init({
  ctx: taskCtx,
});

// FIXME: use harden.js to deep freeze primoridials
// freeze the object to prevent malicious tampering of the secureConfig
export const ghjk = Object.freeze({
  getConfig: Object.freeze(getConfig),
  execTask: Object.freeze(execTask),
});

export { $, install, logger, secureConfig, stdDeps, task, task2 };

function install(...configs: InstallConfigFat[]) {
  const cx = portsConfig;
  for (const config of configs) {
    addInstall(cx, config);
  }
}

export type TaskConfig = Omit<zcli.CommandConfig, "commands">;

function task(name: string, config?: TaskConfig) {
  const cmd = tasksCli.command(name, config);
  tasks.comands[name] = cmd;
  return cmd;
}

function task2(name: string) {
  const cmd = new cliffy_cmd.Command().name(name);
  tasks.climands[name] = cmd;
  return cmd;
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

async function execTask(name: string, args: string[]) {
  const cmd = tasks.climands[name];
  if (!cmd) {
    throw new Error(`no task defined under "${name}"`);
  }
  await cmd.parse(args);
}

async function getConfig(secureConfig: PortsModuleSecureConfig | undefined) {
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

    // const cmdJsons = await Promise.all(
    //   Object.entries(tasks.comands).map(
    //     async ([name, cmd]) => [name, await zcli_json.zcliJson(tasksCli, cmd)],
    //   ),
    // );
    const cmdJsons2 = await Promise.all(
      Object.entries(tasks.climands).map(
        ([name, cmd]) => [name, {
          name,
          description: cmd.getDescription(),
        }],
      ),
    );
    const tasksConfig: TasksModuleConfig = {
      commands: Object.fromEntries(
        cmdJsons2,
      ),
    };

    const config: SerializedConfig = {
      modules: [{
        id: std_modules.ports,
        config: fullPortsConfig,
      }, {
        id: std_modules.tasks,
        config: tasksConfig,
      }],
    };
    return config;
  } catch (cause) {
    throw new Error(`error constructing config for serializatino`, { cause });
  }
}
