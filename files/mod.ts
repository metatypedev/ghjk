//! This provides the backing implementation of the Ghjkfile frontends.

// NOTE: avoid adding sources of randomness
// here to make the resulting config reasonably stable
// across serializaiton. No random identifiers.

import { multibase32, multibase64 } from "../deps/common.ts";

// ports specific imports
import portsValidators from "../modules/ports/types.ts";
import type {
  AllowedPortDep,
  InstallConfigFat,
  InstallSet,
  InstallSetRefProvision,
  PortsModuleConfigHashed,
} from "../modules/ports/types.ts";
import logger from "../utils/logger.ts";
import {
  $,
  defaultCommandBuilder,
  objectHash,
  Path,
  thinInstallConfig,
  unwrapParseRes,
} from "../utils/mod.ts";
import * as std_ports from "../modules/ports/std.ts";
import * as cpy from "../ports/cpy_bs.ts";
import * as node from "../ports/node.ts";
// host
import type { SerializedConfig } from "../host/types.ts";
import * as std_modules from "../modules/std.ts";
// tasks
// WARN: this module has side-effects and only ever import
// types from it
import type { ExecTaskArgs } from "../modules/tasks/deno.ts";
import { TaskDefHashed, TasksModuleConfig } from "../modules/tasks/types.ts";
// envs
import type {
  EnvRecipe,
  EnvsModuleConfig,
  Provision,
  WellKnownProvision,
} from "../modules/envs/types.ts";

export type EnvDefArgs = {
  name: string;
  installs?: InstallConfigFat[];
  allowedPortDeps?: AllowedPortDep[];
  /**
   * If true or not set, will base the task's env on top
   * of the default env (usually `main`). If false, will build on
   * top of a new env. If given a string, will use the identified env as a base
   * for the task env.
   */
  base?: string | boolean;
  desc?: string;
  vars?: Record<string, string>;
  /**
   * Task to execute when environment is activated.
   */
  onEnter?: string | string[];
  /**
   * Task to execute when environment is deactivated.
   */
  onExit?: string | string[];
};

export type TaskFnArgs = {
  $: ReturnType<typeof task$>;
  argv: string[];
  env: Record<string, string>;
  workingDir: string;
};

export type TaskFn = (
  $: ReturnType<typeof task$>,
  args: TaskFnArgs,
) => Promise<any> | any;

/**
 * Configure a task under the given name or key.
 */
export type TaskDefArgs = {
  name?: string;
  desc?: string;
  dependsOn?: string[];
  workingDir?: string | Path;
  envVars?: Record<string, string>;
  allowedPortDeps?: AllowedPortDep[];
  installs?: InstallConfigFat[];
  base?: string | boolean;
};

export type DenoTaskDefArgs = TaskDefArgs & {
  /**
   * The logic to run when the task is invoked.
   *
   * Note: functions are optional for tasks. If none is set,
   * it'll be a no-op. The task it depends on will still be run.
   */
  fn?: TaskFn;
  /**
   * In order to key the right task when ghjk is requesting
   * execution of a specific task, we identify each using a hash.
   * The {@field fn} is `toString`ed in the hash input.
   * If a ghjkfile is produing identical anonymous tasks for
   * instance, it can provide a none to disambiguate beteween each
   * through hash differences.
   *
   * NOTE: the nonce must be stable across serialization.
   * NOTE: closing over values is generally ill-advised on tasks
   * fns. If you want to close over values, make sure they're stable
   * across re-serializations.
   */
  nonce?: string;
};

type TaskDefTyped = DenoTaskDefArgs & { ty: "denoFile@v1" };

export class Ghjkfile {
  #installSets = new Map<string, InstallSet>();
  #tasks = new Map<string, TaskDefTyped>();
  #bb = new Map<string, unknown>();
  #seenEnvs: Record<string, [EnvBuilder, EnvFinalizer]> = {};

  /* dump() {
    return {
      installSets: Object.fromEntries(this.#installSets),
      bb: Object.fromEntries(this.#bb),
      seenEnvs: Object.fromEntries(
        Object.entries(this.#seenEnvs).map((
          [key, [_builder, finalizer]],
        ) => [key, finalizer()]),
      ),
      tasks: Object.fromEntries(
        Object.entries(this.#tasks).map(([key, task]) => [key, {
          ...task,
          ...(task.ty === "denoFile@v1"
            ? {
              fn: task.fn.toString(),
            }
            : {}),
        }]),
      ),
    };
  } */

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
    logger(import.meta).debug("install added", config);
  }

  setAllowedPortDeps(setId: string, deps: AllowedPortDep[]) {
    const set = this.#getSet(setId);
    set.allowedDeps = Object.fromEntries(
      deps.map((
        dep,
      ) => [dep.manifest.name, dep]),
    );
  }

  addTask(args: TaskDefTyped) {
    // NOTE: we make sure the env base declared here exists
    // this call is necessary to make sure that a `task` can
    // be declared before the `env` but still depend on it.
    // Order-indepency like this makes the `ghjk.ts` way less
    // brittle.
    if (typeof args.base == "string") {
      this.addEnv({ name: args.base });
    }
    let key = args.name;
    if (!key) {
      switch (args.ty) {
        case "denoFile@v1": {
          const { fn, workingDir, ...argsRest } = args;
          key = objectHash(JSON.parse(JSON.stringify({
            ...argsRest,
            workingDir: workingDir instanceof Path
              ? workingDir.toString()
              : workingDir,
            ...(fn
              ? {
                // NOTE: we serialize the function to a string before
                // hashing.
                fn: fn.toString(),
              }
              : {}),
          })));
          key = multibase64.base64urlpad.encode(
            multibase32.base32.decode(key),
          );
          break;
        }
        default:
          throw new Error(`unexpected task type: ${args.ty}`);
      }
    }
    this.#tasks.set(key, {
      ...args,
    });
    return key;
  }

  addEnv(args: EnvDefArgs) {
    let env = this.#seenEnvs[args.name]?.[0];
    if (!env) {
      let finalizer: EnvFinalizer;
      env = new EnvBuilder(this, (fin) => finalizer = fin, args.name);
      this.#seenEnvs[args.name] = [env, finalizer!];
    }
    if (args.base !== undefined) {
      env.base(args.base);
    }
    if (args.installs) {
      env.install(...args.installs);
    }
    if (args.allowedPortDeps) {
      env.allowedPortDeps(args.allowedPortDeps);
    }
    if (args.desc) {
      env.desc(args.desc);
    }
    if (args.vars) {
      env.vars(args.vars);
    }
    if (args.onEnter) {
      env.onEnter(...args.onEnter);
    }
    if (args.onExit) {
      env.onEnter(...args.onExit);
    }
    return env;
  }

  async execTask(
    { key, workingDir, envVars, argv }: ExecTaskArgs,
  ) {
    const task = this.#tasks.get(key);
    if (!task) {
      throw new Error(`no task defined under "${key}"`);
    }
    if (task.ty != "denoFile@v1") {
      throw new Error(`task under "${key}" has unexpected type ${task.ty}`);
    }
    if (task.fn) {
      const custom$ = task$(argv, envVars, workingDir);
      await task.fn(custom$, { argv, env: envVars, $: custom$, workingDir });
    }
  }

  toConfig(
    { defaultEnv, defaultBaseEnv, masterPortDepAllowList }: {
      defaultEnv: string;
      defaultBaseEnv: string;
      ghjkfileUrl: string;
      masterPortDepAllowList: AllowedPortDep[];
    },
  ) {
    try {
      const envsConfig = this.#processEnvs(defaultEnv, defaultBaseEnv);
      const tasksConfig = this.#processTasks(
        envsConfig,
        defaultBaseEnv,
      );
      const portsConfig = this.#processInstalls(
        masterPortDepAllowList ?? stdDeps(),
      );

      const config: SerializedConfig = {
        blackboard: Object.fromEntries(this.#bb.entries()),
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
    const hash = objectHash(JSON.parse(JSON.stringify(inp)));

    if (!this.#bb.has(hash)) {
      this.#bb.set(hash, inp);
    }
    return hash;
  }

  /** this processes the defined envs, normalizing dependency (i.e. "envBase")
   * relationships to produce the standard EnvsModuleConfig
   */
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
      const envBaseResolved = typeof final.base === "string"
        ? final.base
        : final.base && defaultBaseEnv != final.name
        ? defaultBaseEnv
        : null;
      all[final.name] = { ...final, envBaseResolved };
      if (envBaseResolved) {
        const parentRevDeps = revDeps.get(envBaseResolved);
        if (parentRevDeps) {
          parentRevDeps.push(final.name);
        } else {
          revDeps.set(envBaseResolved, [final.name]);
        }
      } else {
        indie.push(final.name);
      }
    }

    const processed = {} as Record<
      string,
      { installSetId?: string; vars: Record<string, string> }
    >;
    const moduleConfig: EnvsModuleConfig = { envs: {}, defaultEnv };
    const workingSet = indie;
    while (workingSet.length > 0) {
      const item = workingSet.pop()!;
      const final = all[item];

      const base = final.envBaseResolved
        ? processed[final.envBaseResolved]
        : null;

      const processedVars = {
        ...(base?.vars ?? {}),
        ...final.vars,
      };

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
      processed[final.name] = {
        installSetId: processedInstallSetId,
        vars: processedVars,
      };
      const hooks = [
        ...final.onEnterHookTasks.map(
          (key) => [key, "hook.onEnter.posixExec"] as const,
        ),
        ...final.onExitHookTasks.map(
          (key) => [key, "hook.onExit.posixExec"] as const,
        ),
      ].map(([taskKey, ty]) => {
        const task = this.#tasks.get(taskKey);
        if (!task) {
          throw new Error("unable to find task for onEnterHook", {
            cause: {
              env: final.name,
              taskKey,
            },
          });
        }
        if (task.ty == "denoFile@v1") {
          const prov: InlineTaskHookProvision = {
            ty: "inline.hook.ghjkTask",
            finalTy: ty,
            taskKey,
          };
          return prov;
        }
        throw new Error(
          `unsupported task type "${task.ty}" used for environment hook`,
          {
            cause: {
              taskKey,
              task,
            },
          },
        );
      });
      moduleConfig.envs[final.name] = {
        desc: final.desc,
        provides: [
          ...Object.entries(processedVars).map((
            [key, val],
          ) => {
            const prov: WellKnownProvision = { ty: "posix.envVar", key, val };
            return prov;
          }),
          // env hooks
          ...hooks,
        ],
      };
      if (processedInstallSetId) {
        const prov: InstallSetRefProvision = {
          ty: "ghjk.ports.InstallSetRef",
          setId: processedInstallSetId,
        };
        moduleConfig.envs[final.name].provides.push(prov);
      }

      const curRevDeps = revDeps.get(final.name);
      if (curRevDeps) {
        workingSet.push(...curRevDeps);
        revDeps.delete(final.name);
      }
    }
    // sanity checks
    if (revDeps.size > 0) {
      throw new Error("working set empty but pending items found");
    }
    return moduleConfig;
  }

  #processTasks(
    envsConfig: EnvsModuleConfig,
    defaultBaseEnv: string,
  ) {
    const indie = [] as string[];
    const deps = new Map<string, string[]>();
    const revDeps = new Map<string, string[]>();
    const nameToKey = Object.fromEntries(
      Object.entries(this.#tasks)
        .filter(([_, { name }]) => !!name)
        .map(([hash, { name }]) => [name, hash] as const),
    );
    for (const [key, args] of this.#tasks) {
      if (args.dependsOn && args.dependsOn.length > 0) {
        const depKeys = args.dependsOn.map((nameOrKey) =>
          nameToKey[nameOrKey] ?? nameOrKey
        );
        deps.set(key, depKeys);
        for (const depKey of depKeys) {
          const depRevDeps = revDeps.get(depKey);
          if (depRevDeps) {
            depRevDeps.push(key);
          } else {
            revDeps.set(depKey, [key]);
          }
        }
      } else {
        indie.push(key);
      }
    }
    const workingSet = indie;
    const localToFinalKey = {} as Record<string, string>;
    const moduleConfig: TasksModuleConfig = {
      envs: {},
      tasks: {},
      tasksNamed: [],
    };
    while (workingSet.length > 0) {
      const key = workingSet.pop()!;
      const args = this.#tasks.get(key)!;
      const { workingDir, desc, dependsOn, base } = args;

      const envBaseResolved = typeof base === "string"
        ? base
        : base
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
        const setId = `ghjkTaskInstSet___${key}`;
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

      const envHash = objectHash(JSON.parse(JSON.stringify(taskEnvRecipe)));
      moduleConfig.envs[envHash] = taskEnvRecipe;

      const def: TaskDefHashed = {
        ty: args.ty,
        key,
        workingDir: typeof workingDir == "object"
          ? workingDir.toString()
          : workingDir,
        desc,
        dependsOn: dependsOn?.map((keyOrHash) =>
          localToFinalKey[nameToKey[keyOrHash] ?? keyOrHash]
        ),
        envHash,
      };
      const taskHash = objectHash(def);
      // we prefer the name as a key if present
      const finalKey = args.name ?? taskHash;
      moduleConfig.tasks[finalKey] = def;
      localToFinalKey[key] = finalKey;

      if (args.name) {
        moduleConfig.tasksNamed.push(args.name);
      }
      for (const revDepKey of revDeps.get(key) ?? []) {
        const revDepDeps = deps.get(revDepKey)!;
        // swap remove
        const idx = revDepDeps.indexOf(key);
        const last = revDepDeps.pop()!;
        if (revDepDeps.length > idx) {
          revDepDeps[idx] = last;
        }

        if (revDepDeps.length == 0) {
          deps.delete(revDepKey);
          workingSet.push(revDepKey);
        }
      }
    }

    // do some sanity checks
    for (const [key, { dependsOn }] of Object.entries(moduleConfig.tasks)) {
      for (const depName of dependsOn ?? []) {
        if (!moduleConfig.tasks[depName]) {
          throw new Error(
            `task "${key}" depend on non-existent task "${depName}"`,
            {
              cause: {
                workingSet,
                revDeps,
                moduleConfig,
                tasks: this.#tasks,
                nameToKey,
              },
            },
          );
        }
      }
    }
    if (deps.size > 0) {
      throw new Error("working set empty but pending items found", {
        cause: {
          workingSet,
          revDeps,
          moduleConfig,
          tasks: this.#tasks,
        },
      });
    }

    for (const [_name, env] of Object.entries(envsConfig.envs)) {
      env.provides = env.provides.map(
        (prov) => {
          if (
            prov.ty == "inline.hook.ghjkTask"
          ) {
            const inlineProv = prov as InlineTaskHookProvision;
            const taskKey = localToFinalKey[inlineProv.taskKey];
            const out: WellKnownProvision = {
              ty: inlineProv.finalTy,
              program: "ghjk",
              arguments: ["x", taskKey],
            };
            return out;
          }
          return prov;
        },
      );
    }

    return moduleConfig;
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
  base: string | boolean;
  vars: Record<string, string>;
  desc?: string;
  onEnterHookTasks: string[];
  onExitHookTasks: string[];
};

// this class will be exposed to users and thus features
// a contrived implementation of the `build`/`finalize` method
// all to avoid exposing the function in the public api
export class EnvBuilder {
  #installSetId: string;
  #file: Ghjkfile;
  #base: string | boolean = true;
  #vars: Record<string, string> = {};
  #desc?: string;
  #onEnterHookTasks: string[] = [];
  #onExitHookTasks: string[] = [];

  constructor(
    file: Ghjkfile,
    setFinalizer: (fin: EnvFinalizer) => void,
    public name: string,
  ) {
    this.#file = file;
    this.#installSetId = `ghjkEnvProvInstSet___${name}`;
    setFinalizer(() => ({
      name: this.name,
      installSetId: this.#installSetId,
      base: this.#base,
      vars: this.#vars,
      desc: this.#desc,
      onExitHookTasks: this.#onExitHookTasks,
      onEnterHookTasks: this.#onEnterHookTasks,
    }));
  }

  base(base: string | boolean) {
    this.#base = base;
    return this;
  }

  /**
   * Provision a port install in the environment.
   */
  install(...configs: InstallConfigFat[]) {
    for (const config of configs) {
      this.#file.addInstall(this.#installSetId, config);
    }
    return this;
  }

  /**
   * This is treated as a single set and will replace previously any configured set.
   */
  allowedPortDeps(deps: AllowedPortDep[]) {
    this.#file.setAllowedPortDeps(this.#installSetId, deps);
    return this;
  }

  /**
   * Add an environment variable.
   */
  var(key: string, val: string) {
    this.vars({ [key]: val });
    return this;
  }

  /**
   * Add multiple environment variable.
   */
  vars(envVars: Record<string, string>) {
    Object.assign(this.#vars, envVars);
    return this;
  }

  /**
   * Description of the environment.
   */
  desc(str: string) {
    this.#desc = str;
    return this;
  }

  /**
   * Tasks to execute on enter.
   */
  onEnter(...taskKey: string[]) {
    this.#onEnterHookTasks.push(...taskKey);
    return this;
  }

  /**
   * Tasks to execute on enter.
   */
  onExit(...taskKey: string[]) {
    this.#onExitHookTasks.push(...taskKey);
    return this;
  }
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
        const out: AllowedPortDep = {
          manifest: fatInst.port,
          defaultInst: thinInstallConfig(fatInst),
        };
        return portsValidators.allowedPortDep.parse(out);
      }),
    );
  }
  return out;
}

function task$(
  argv: string[],
  env: Record<string, string | undefined>,
  workingDir: string,
) {
  const custom$ = Object.assign(
    // NOTE: order is important on who assigns to who
    // here
    $.build$({
      commandBuilder: defaultCommandBuilder().env(env).cwd(workingDir),
    }),
    {
      argv,
      env,
      workingDir,
    },
  );
  return custom$;
}

type InlineTaskHookProvision = Provision & {
  ty: "inline.hook.ghjkTask";
  finalTy:
    | "hook.onEnter.posixExec"
    | "hook.onExit.posixExec";
  taskKey: string;
};
