//! This module is intended to be re-exported by `ghjk.ts` config scripts. Please
//! avoid importing elsewhere at it has side-effects.

// NOTE: avoid adding sources of randomness
// here to make the resulting config reasonably stable
// across serializaiton. No random identifiers.
// TODO: harden most of the items in here

import "./setup_logger.ts";

// ports specific imports
import portsValidators from "./modules/ports/types.ts";
import type {
  AllowedPortDep,
  InstallConfigFat,
  InstallSet,
  InstallSetRefProvision,
  PortsModuleConfigHashed,
  PortsModuleSecureConfig,
} from "./modules/ports/types.ts";
import logger from "./utils/logger.ts";
import {
  $,
  defaultCommandBuilder,
  thinInstallConfig,
  unwrapParseRes,
} from "./utils/mod.ts";
import * as std_ports from "./modules/ports/std.ts";
import * as cpy from "./ports/cpy_bs.ts";
import * as node from "./ports/node.ts";
// host
import type { SerializedConfig } from "./host/types.ts";
import * as std_modules from "./modules/std.ts";
// tasks
import { dax, jsonHash, objectHash } from "./deps/common.ts";
// WARN: this module has side-effects and only ever import
// types from it
import type { ExecTaskArgs } from "./modules/tasks/deno.ts";
import { TasksModuleConfig } from "./modules/tasks/types.ts";
// envs
import {
  EnvRecipe,
  EnvsModuleConfig,
  WellKnownProvision,
} from "./modules/envs/types.ts";

const DEFAULT_BASE_ENV_NAME = "main";

export type EnvDefArgs = {
  name: string;
  installs?: InstallConfigFat[];
  allowedPortDeps?: AllowedPortDep[];
  /*
   * If true or not set, will base the task's env on top
   * of the default env (usually `main`). If false, will build on
   * top of a new env. If given a string, will use the identified env as a base
   * for the task env.
   */
  envBase?: string | boolean;
};

export type TaskFnArgs = {
  $: dax.$Type;
  argv: string[];
  env: Record<string, string>;
};

export type TaskFn = (args: TaskFnArgs) => Promise<any> | any;

/*
 * Configuration for a task.
 */
export type TaskDefArgs = {
  name: string;
  fn: TaskFn;
  desc?: string;
  dependsOn?: string[];
  workingDir?: string | dax.PathRef;
  envVars?: Record<string, string>;
  allowedPortDeps?: AllowedPortDep[];
  installs?: InstallConfigFat[];
  envBase?: string | boolean;
};

class GhjkfileBuilder {
  #installSets = new Map<string, InstallSet>();
  #tasks = {} as Record<string, TaskDefArgs>;
  #bb = new Map<string, unknown>();
  #seenEnvs: Record<string, [EnvBuilder, EnvFinalizer]> = {};

  addInstall(setId: string, configUnclean: InstallConfigFat) {
    const config = unwrapParseRes(
      portsValidators.installConfigFat.safeParse(configUnclean),
      {
        config: configUnclean,
      },
      `error parsing InstallConfig`,
    );

    const set = this.#getSet(setId);
    set.installs.push(config);
    logger().debug("install added", config);
  }

  setAllowedPortDeps(setId: string, deps: AllowedPortDep[]) {
    const set = this.#getSet(setId);
    set.allowedDeps = Object.fromEntries(
      deps.map((
        dep,
      ) => [dep.manifest.name, dep]),
    );
  }

  addTask(args: TaskDefArgs) {
    // NOTE: we make sure the env base declared here exists
    // this call is necessary to make sure that a `task` can
    // be declared before the `env` but still depend on it.
    // Order-indepency like this makes the `ghjk.ts` way less
    // brittle.
    if (typeof args.envBase == "string") {
      this.addEnv({ name: args.envBase });
    }

    this.#tasks[args.name] = {
      ...args,
      name,
    };
    return args.name;
  }

  addEnv(args: EnvDefArgs) {
    let env = this.#seenEnvs[args.name]?.[0];
    if (!env) {
      let finalizer: EnvFinalizer;
      env = new EnvBuilder(this, (fin) => finalizer = fin, args.name);
      this.#seenEnvs[args.name] = [env, finalizer!];
    }
    if (args.envBase !== undefined) {
      env.base(args.envBase);
    }
    if (args.installs) {
      env.install(...args.installs);
    }
    if (args.allowedPortDeps) {
      env.allowedPortDeps(args.allowedPortDeps);
    }
    return env;
  }

  async execTask(
    { name, workingDir, envVars, argv }: ExecTaskArgs,
  ) {
    const task = this.#tasks[name];
    if (!task) {
      throw new Error(`no task defined under "${name}"`);
    }
    const custom$ = $.build$({
      commandBuilder: defaultCommandBuilder().env(envVars).cwd(workingDir),
    });
    await task.fn({ argv, env: envVars, $: custom$ });
  }

  toConfig(secureConfig: PortsModuleSecureConfig | undefined) {
    try {
      const defaultEnv = secureConfig?.defaultEnv ?? DEFAULT_BASE_ENV_NAME;
      const defaultBaseEnv = secureConfig?.defaultBaseEnv ??
        DEFAULT_BASE_ENV_NAME;
      const envsConfig = this.#processEnvs(
        defaultEnv,
        defaultBaseEnv,
      );
      const tasksConfig = this.#processTasks(envsConfig, defaultBaseEnv);
      const portsConfig = this.#processInstalls(
        secureConfig?.masterPortDepAllowList ?? stdDeps(),
      );

      const config: SerializedConfig = {
        modules: [{
          id: std_modules.ports,
          config: portsConfig,
        }, {
          id: std_modules.tasks,
          config: tasksConfig,
        }, {
          id: std_modules.envs,
          config: envsConfig,
        }],
        blackboard: Object.fromEntries(this.#bb.entries()),
      };
      return config;
    } catch (cause) {
      throw new Error(`error constructing config for serialization`, { cause });
    }
  }

  #getSet(setId: string) {
    let set = this.#installSets.get(setId);
    if (!set) {
      set = { installs: [], allowedDeps: {} };
      this.#installSets.set(setId, set);
    }
    return set;
  }

  #addToBlackboard(inp: unknown) {
    // jsonHash.digest is async
    const hash = objectHash(jsonHash.canonicalize(inp as jsonHash.Tree));

    if (!this.#bb.has(hash)) {
      this.#bb.set(hash, inp);
    }
    return hash;
  }

  // this processes the defined envs, normalizing dependency (i.e. "envBase")
  // relationships to produce the standard EnvsModuleConfig
  #processEnvs(
    defaultEnv: string,
    defaultBaseEnv: string,
  ) {
    const all = {} as Record<
      string,
      ReturnType<EnvFinalizer> & { envBaseResolved: null | string }
    >;
    const indie = [] as string[];
    const revDeps = new Map<string, string[]>();
    for (
      const [_name, [_builder, finalizer]] of Object.entries(this.#seenEnvs)
    ) {
      const final = finalizer();
      const { name, envBase } = final;
      const envBaseResolved = typeof envBase === "string"
        ? envBase
        : envBase
        ? defaultBaseEnv
        : null;
      all[name] = { ...final, envBaseResolved };
      if (envBaseResolved) {
        let parentRevDeps = revDeps.get(envBaseResolved);
        if (!parentRevDeps) {
          parentRevDeps = [];
          revDeps.set(envBaseResolved, parentRevDeps);
        }
        parentRevDeps.push(final.name);
      } else {
        indie.push(name);
      }
    }
    const processed = {} as Record<string, { installSetId?: string }>;
    const out: EnvsModuleConfig = { envs: {}, defaultEnv };
    const workingSet = [...indie];
    while (workingSet.length > 0) {
      const item = workingSet.pop()!;
      const final = all[item];

      const base = final.envBaseResolved
        ? processed[final.envBaseResolved]
        : null;

      let processedInstallSetId: string | undefined;
      {
        const installSet = this.#installSets.get(final.installSetId);
        if (installSet) {
          // if base also has an install set
          if (base?.installSetId) {
            // merge the parent's installs into this one
            const baseSet = this.#installSets.get(
              base.installSetId,
            )!;
            const mergedInstallsSet = new Set([
              ...installSet.installs,
              ...baseSet.installs,
            ]);
            installSet.installs = [...mergedInstallsSet.values()];
            for (
              const [key, val] of Object.entries(baseSet.allowedDeps)
            ) {
              // prefer the port dep config of the child over any
              // similar deps in the parent
              if (!installSet.allowedDeps[key]) {
                installSet.allowedDeps[key] = val;
              }
            }
          }
          processedInstallSetId = final.installSetId;
        } // if there's no install set found under the id
        else {
          // implies that the env has not ports explicitly configured
          if (base) {
            processedInstallSetId = base.installSetId;
          }
        }
      }
      processed[final.name] = { installSetId: processedInstallSetId };
      out.envs[final.name] = {
        provides: [
          ...Object.entries(final.vars).map((
            [key, val],
          ) => {
            const prov: WellKnownProvision = { ty: "posix.envVar", key, val };
            return prov;
          }),
        ],
      };
      if (processedInstallSetId) {
        const prov: InstallSetRefProvision = {
          ty: "ghjk.ports.InstallSetRef",
          setId: processedInstallSetId,
        };
        out.envs[final.name].provides.push(prov);
      }

      const curRevDeps = revDeps.get(final.name);
      if (curRevDeps) {
        workingSet.push(...curRevDeps);
        revDeps.delete(final.name);
      }
    }
    return out;
  }

  #processTasks(envsConfig: EnvsModuleConfig, defaultBaseEnv: string) {
    const out: TasksModuleConfig = {
      envs: {},
      tasks: {},
    };
    for (
      const [name, args] of Object
        .entries(
          this.#tasks,
        )
    ) {
      const { workingDir, desc, dependsOn, envBase } = args;
      const envBaseResolved = typeof envBase === "string"
        ? envBase
        : envBase
        ? defaultBaseEnv
        : null;

      const envBaseRecipe = envBaseResolved
        ? envsConfig.envs[envBaseResolved]
        : null;

      const taskEnvRecipe: EnvRecipe = {
        provides: [],
      };

      const taskInstallSet: InstallSet = {
        installs: args.installs ?? [],
        allowedDeps: Object.fromEntries(
          (args.allowedPortDeps ?? []).map((dep) => [dep.manifest.name, dep]),
        ),
      };

      const mergedEnvVars = args.envVars ?? {};
      if (envBaseRecipe) {
        for (
          const prov of envBaseRecipe
            .provides as (
              | WellKnownProvision
              | InstallSetRefProvision
            )[]
        ) {
          if (prov.ty == "posix.envVar") {
            if (!mergedEnvVars[prov.key]) {
              mergedEnvVars[prov.key] = prov.val;
            }
          } else if (prov.ty == "ghjk.ports.InstallSetRef") {
            const baseSet = this.#installSets.get(prov.setId)!;
            const mergedInstallsSet = new Set([
              ...taskInstallSet.installs,
              ...baseSet.installs,
            ]);
            taskInstallSet.installs = [...mergedInstallsSet.values()];
            for (
              const [key, val] of Object.entries(baseSet.allowedDeps)
            ) {
              // prefer the port dep config of the child over any
              // similar deps in the base
              if (!taskInstallSet.allowedDeps[key]) {
                taskInstallSet.allowedDeps[key] = val;
              }
            }
          } else {
            taskEnvRecipe.provides.push(prov);
          }
        }
      }
      if (taskInstallSet.installs.length > 0) {
        const setId = `ghjkTaskInstSet___${name}`;
        this.#installSets.set(setId, taskInstallSet);
        const prov: InstallSetRefProvision = {
          ty: "ghjk.ports.InstallSetRef",
          setId,
        };
        taskEnvRecipe.provides.push(prov);
      }

      taskEnvRecipe.provides.push(
        ...Object.entries(mergedEnvVars).map((
          [key, val],
        ) => {
          const prov: WellKnownProvision = { ty: "posix.envVar", key, val };
          return prov;
        }),
      );

      const envHash = objectHash(
        jsonHash.canonicalize(taskEnvRecipe as jsonHash.Tree),
      );
      out.envs[envHash] = taskEnvRecipe;

      out.tasks[name] = {
        name,
        workingDir: typeof workingDir == "object"
          ? workingDir.toString()
          : workingDir,
        desc,
        dependsOn,
        envHash,
      };
    }
    for (const [name, { dependsOn }] of Object.entries(out.tasks)) {
      for (const depName of dependsOn ?? []) {
        if (!out.tasks[depName]) {
          throw new Error(
            `task "${name}" depend on non-existent task "${depName}"`,
          );
        }
      }
    }

    return out;
  }

  #processInstalls(masterAllowList: AllowedPortDep[]) {
    const out: PortsModuleConfigHashed = {
      sets: {},
    };
    const masterPortDepAllowList = Object.fromEntries(
      masterAllowList.map((dep) => [dep.manifest.name, dep] as const),
    );
    for (
      const [setId, set] of this.#installSets.entries()
    ) {
      for (const [portName, _] of Object.entries(set.allowedDeps)) {
        if (!masterPortDepAllowList[portName]) {
          throw new Error(
            `"${portName}" is in allowedPortDeps list of install set "${setId}" but not in the masterPortDepAllowList`,
          );
        }
      }
      for (const [name, hash] of Object.entries(masterPortDepAllowList)) {
        if (!set.allowedDeps[name]) {
          set.allowedDeps[name] = hash;
        }
      }
      out.sets[setId] = {
        installs: set.installs.map((inst) => this.#addToBlackboard(inst)),
        allowedDeps: this.#addToBlackboard(Object.fromEntries(
          Object.entries(set.allowedDeps).map(
            ([key, dep]) => [key, this.#addToBlackboard(dep)],
          ),
        )),
      };
    }
    return out;
  }
}

type EnvFinalizer = () => {
  name: string;
  installSetId: string;
  envBase: string | boolean;
  vars: Record<string, string>;
};

// this class will be exposed to users and thus features
// a contrived implementation of the `build`/`finalize` method
// all to avoid exposing the function in the public api
class EnvBuilder {
  #installSetId: string;
  #file: GhjkfileBuilder;
  #base: string | boolean = true;
  #vars: Record<string, string> = {};

  constructor(
    file: GhjkfileBuilder,
    setFinalizer: (fin: EnvFinalizer) => void,
    public name: string,
  ) {
    this.#file = file;
    this.#installSetId = `ghjkEnvProvInstSet___${name}`;
    setFinalizer(() => ({
      name: this.name,
      installSetId: this.#installSetId,
      envBase: this.#base,
      vars: this.#vars,
    }));
  }

  base(base: string | boolean) {
    this.#base = base;
  }

  /*
   * Provision a port install in the environment.
   */
  install(...configs: InstallConfigFat[]) {
    for (const config of configs) {
      this.#file.addInstall(this.#installSetId, config);
    }
    return this;
  }

  /*
   * This is treated as a single set and will replace previously any configured set.
   */
  allowedPortDeps(deps: AllowedPortDep[]) {
    this.#file.setAllowedPortDeps(this.#installSetId, deps);
  }

  var(key: string, val: string) {
    this.vars({ [key]: val });
  }

  vars(envVars: Record<string, string>) {
    Object.assign(this.#vars, envVars);
  }
}

const file = new GhjkfileBuilder();
const mainEnv = file.addEnv({
  name: DEFAULT_BASE_ENV_NAME,
  envBase: false,
  allowedPortDeps: stdDeps(),
});

export { $, logger };

// FIXME: ses.lockdown to freeze primoridials
// freeze the object to prevent malicious tampering of the secureConfig
export const ghjk = Object.freeze({
  getConfig: Object.freeze(
    (secureConfig: PortsModuleSecureConfig | undefined) =>
      file.toConfig(secureConfig),
  ),
  execTask: Object.freeze(
    (args: ExecTaskArgs) => file.execTask(args),
  ),
});

/*
 * Provision a port install in the `main` environment.
 */
export function install(...configs: InstallConfigFat[]) {
  mainEnv.install(...configs);
}

export function task(args: TaskDefArgs): string;
export function task(name: string, args: Omit<TaskDefArgs, "name">): string;
export function task(name: string, fn: TaskFn): string;
export function task(
  nameOrArgs: string | TaskDefArgs,
  argsOrFn?: Omit<TaskDefArgs, "name"> | TaskFn,
): string {
  let args: TaskDefArgs;
  if (typeof nameOrArgs == "object") {
    args = nameOrArgs;
  } else if (typeof argsOrFn == "object") {
    args = { ...argsOrFn, name: nameOrArgs };
  } else if (argsOrFn) {
    args = {
      name: nameOrArgs,
      fn: argsOrFn,
    };
  } else {
    throw new Error("no function provided when defining task");
  }
  return file.addTask(args);
}

export function env(args: EnvDefArgs): EnvBuilder;
export function env(name: string, args?: Omit<EnvDefArgs, "name">): EnvBuilder;
export function env(
  nameOrArgs: string | EnvDefArgs,
  argsMaybe?: Omit<EnvDefArgs, "name">,
): EnvBuilder {
  const args = typeof nameOrArgs == "object"
    ? nameOrArgs
    : { ...argsMaybe, name: nameOrArgs };
  return file.addEnv(args);
}

export function stdSecureConfig(
  args: {
    additionalAllowedPorts?: PortsModuleSecureConfig["masterPortDepAllowList"];
    enableRuntimes?: boolean;
  } & Pick<PortsModuleSecureConfig, "defaultEnv" | "defaultBaseEnv">,
): PortsModuleSecureConfig {
  const { additionalAllowedPorts, enableRuntimes = false } = args;
  const out: PortsModuleSecureConfig = {
    masterPortDepAllowList: [
      ...stdDeps({ enableRuntimes }),
      ...additionalAllowedPorts ?? [],
    ],
  };
  return out;
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
