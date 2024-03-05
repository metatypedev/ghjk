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
import { $, defaultCommandBuilder, thinInstallConfig } from "./utils/mod.ts";
import * as std_ports from "./modules/ports/std.ts";
import * as cpy from "./ports/cpy_bs.ts";
import * as node from "./ports/node.ts";
// hosts
import type { GlobalEnv, SerializedConfig } from "./host/types.ts";
import * as std_modules from "./modules/std.ts";
// tasks
import type {
  TaskDef,
  TaskEnv,
  TasksModuleConfig,
} from "./modules/tasks/types.ts";
import { dax, jsonHash, objectHash } from "./deps/common.ts";

const portsConfig: PortsModuleConfigBase = { installs: [] };

export type TaskFnArgs = {
  $: dax.$Type;
  argv: string[];
  env: Record<string, string>;
};
export type TaskFn = (args: TaskFnArgs) => Promise<void>;

export type TaskFnDef = TaskDef & {
  fn: TaskFn;
  // command: cliffy_cmd.Command;
};

// TODO tasks config
const tasks = {} as Record<string, TaskFnDef>;

const globalEnv: GlobalEnv = {
  installs: {},
  allowedPortDeps: {},
};

// FIXME: ses.lockdown to freeze primoridials
// freeze the object to prevent malicious tampering of the secureConfig
export const ghjk = Object.freeze({
  getConfig: Object.freeze(getConfig),
  execTask: Object.freeze(execTask),
});

export { $, logger };

export function install(...configs: InstallConfigFat[]) {
  const cx = portsConfig;
  for (const config of configs) {
    addInstall(cx, config);
  }
}

function registerInstall(config: InstallConfigFat) {
  // jsonHash.digest is async
  const hash = objectHash(jsonHash.canonicalize(config as jsonHash.Tree));

  if (!globalEnv.installs[hash]) {
    globalEnv.installs[hash] = config;
  }
  return hash;
}

function registerAllowedPortDep(dep: AllowedPortDep) {
  const hash = objectHash(jsonHash.canonicalize(dep as jsonHash.Tree));
  if (!globalEnv.allowedPortDeps[hash]) {
    globalEnv.allowedPortDeps[hash] = dep;
  }
  return hash;
}

/*
 * A nicer form of TaskFnDef for better ergonomics in the ghjkfile
 */
export type TaskDefNice =
  & Omit<TaskFnDef, "env" | "name" | "dependsOn">
  & Partial<Pick<TaskFnDef, "dependsOn">>
  & Partial<Pick<TaskEnv, "env">>
  & { allowedPortDeps?: AllowedPortDep[]; installs?: InstallConfigFat[] };
export function task(name: string, config: TaskDefNice) {
  const allowedPortDeps = [
    ...(config.allowedPortDeps ?? (config.installs ? stdDeps() : [])),
  ].map(registerAllowedPortDep);

  // TODO validate installs?
  const installs = (config.installs ?? []).map(registerInstall);

  tasks[name] = {
    name,
    fn: config.fn,
    desc: config.desc,
    dependsOn: config.dependsOn ?? [],
    env: {
      installs,
      env: config.env ?? {},
      allowedPortDeps,
    },
  };
  return name;
}

function addInstall(
  cx: PortsModuleConfigBase,
  configUnclean: InstallConfigFat,
) {
  const res = portsValidators.installConfigFat.safeParse(configUnclean);
  if (!res.success) {
    throw new Error(`error parsing InstallConfig`, {
      cause: {
        config: configUnclean,
        zodErr: res.error,
      },
    });
  }
  const config = res.data;
  logger().debug("install added", config);
  cx.installs.push(registerInstall(config));
}

export function secureConfig(
  config: PortsModuleSecureConfig,
) {
  return config;
}

export function stdDeps(args = { enableRuntimes: false }) {
  const out: AllowedPortDep[] = [
    ...Object.values(std_ports.map),
  ];
  if (args.enableRuntimes) {
    out.push(
      ...[
        node.default(),
        cpy.default(),
      ].map((fatInst) => {
        return portsValidators.allowedPortDep.parse({
          manifest: fatInst.port,
          defaultInst: thinInstallConfig(fatInst),
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
            registerAllowedPortDep(portsValidators.allowedPortDep.parse(dep)),
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
      globalEnv,
    };
    return config;
  } catch (cause) {
    throw new Error(`error constructing config for serialization`, { cause });
  }
}
