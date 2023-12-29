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
import { $, defaultCommandBuilder, getPortRef } from "./utils/mod.ts";
import * as std_ports from "./modules/ports/std.ts";
import * as cpy from "./ports/cpy_bs.ts";
import * as node from "./ports/node.ts";
// hosts
import type { SerializedConfig } from "./host/types.ts";
import * as std_modules from "./modules/std.ts";
// tasks
import type { TaskEnv, TasksModuleConfig } from "./modules/tasks/types.ts";
import { dax } from "./deps/common.ts";

const portsConfig: PortsModuleConfigBase = { installs: [] };

export type TaskFnArgs = {
  $: dax.$Type;
  argv: string[];
  env: Record<string, string>;
};
export type TaskFn = (args: TaskFnArgs) => Promise<void>;

export type UserTask = {
  env: TaskEnv;
  desc?: string;
  fn: TaskFn;
  // command: cliffy_cmd.Command;
};
const tasks = {} as Record<
  string,
  UserTask
>;

// FIXME: ses.lockdown to freeze primoridials
// freeze the object to prevent malicious tampering of the secureConfig
export const ghjk = Object.freeze({
  getConfig: Object.freeze(getConfig),
  execTask: Object.freeze(execTask),
});

export { $, install, logger, secureConfig, stdDeps, task };

function install(...configs: InstallConfigFat[]) {
  const cx = portsConfig;
  for (const config of configs) {
    addInstall(cx, config);
  }
}

export type TaskConfig = Omit<UserTask, "env"> & Partial<TaskEnv>;
function task(name: string, config: TaskConfig) {
  tasks[name] = {
    ...config,
    env: {
      installs: [],
      env: {},
      allowedPortDeps: {},
      ...config,
    },
  };
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
            portRef: getPortRef(port),
            ...liteInst,
          },
        });
      }),
    );
  }
  return out;
}

async function execTask(
  name: string,
  argv: string[],
  envVars: Record<string, string>,
) {
  const task = tasks[name];
  if (!task) {
    throw new Error(`no task defined under "${name}"`);
  }
  const custom$ = $.build$({
    commandBuilder: defaultCommandBuilder().env(envVars),
  });
  await task.fn({ argv, env: envVars, $: custom$ });
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
      Object.entries(tasks).map(
        ([name, task]) => [name, {
          name,
          ...task,
        }],
      ),
    );
    const tasksConfig: TasksModuleConfig = {
      tasks: Object.fromEntries(
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
