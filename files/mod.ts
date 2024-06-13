//! This provides the backing implementation of the Ghjkfile frontends.

// NOTE: avoid adding sources of randomness
// here to make the resulting config reasonably stable
// across serializaiton. No random identifiers.

import { deep_eql, multibase32, multibase64, zod } from "../deps/common.ts";

// ports specific imports
import portsValidators from "../modules/ports/types.ts";
import type {
  AllowedPortDep,
  InstallConfigFat,
  InstallSet,
  InstallSetRefProvision,
  PortsModuleConfigHashed,
} from "../modules/ports/types.ts";
import getLogger from "../utils/logger.ts";
const logger = getLogger(import.meta);
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
import modulesValidators from "../modules/types.ts";

const validators = {
  envVars: zod.record(
    modulesValidators.envVarName,
    zod.union([zod.string(), zod.number()]),
  ),
};

export type EnvParent = string | string[] | boolean | undefined;

export type EnvDefArgs = {
  name: string;
  installs?: InstallConfigFat[];
  allowedBuildDeps?: (InstallConfigFat | AllowedPortDep)[];
  /**
   * If true or not set, will base the task's env on top
   * of the default env (usually `main`). If false, will build on
   * top of a new env. If given a string, will use the identified env as a base
   * for the task env.
   */
  inherit?: EnvParent;
  desc?: string;
  vars?: Record<string, string | number>;
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
  dependsOn?: string | string[];
  workingDir?: string | Path;
  vars?: Record<string, string | number>;
  allowedBuildDeps?: (InstallConfigFat | AllowedPortDep)[];
  installs?: InstallConfigFat | InstallConfigFat[];
  inherit?: EnvParent;
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
  finalizedEnvs: Record<
    string,
    {
      finalized: ReturnType<EnvFinalizer>;
      installSetId?: string;
      vars: Record<string, string>;
    }
  > = {};

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
    logger.debug("install added", config);
  }

  setAllowedPortDeps(
    setId: string,
    deps: (InstallConfigFat | AllowedPortDep)[],
  ) {
    const set = this.#getSet(setId);
    set.allowedBuildDeps = Object.fromEntries(
      reduceAllowedDeps(deps).map((
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
    if (typeof args.inherit == "string") {
      this.addEnv({ name: args.inherit });
    } else if (Array.isArray(args.inherit)) {
      for (const name of args.inherit) {
        this.addEnv({ name });
      }
    }
    // FIXME: combine the task env processing
    // with normal env processing
    // we currrently process task envs at once in the end
    // to do env deduplication
    if (args.vars) {
      args.vars = unwrapParseRes(validators.envVars.safeParse(args.vars), {
        vars: args.vars,
      });
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
    if (args.inherit !== undefined) {
      env.inherit(args.inherit);
    }
    if (args.installs) {
      env.install(...args.installs);
    }
    if (args.allowedBuildDeps) {
      env.allowedBuildDeps(...args.allowedBuildDeps);
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
    { defaultEnv, defaultBaseEnv }: {
      defaultEnv: string;
      defaultBaseEnv: string;
      ghjkfileUrl: string;
    },
  ) {
    // make sure referenced envs exist
    this.addEnv({ name: defaultEnv });
    this.addEnv({ name: defaultBaseEnv });
    try {
      const envsConfig = this.#processEnvs(defaultEnv, defaultBaseEnv);
      const tasksConfig = this.#processTasks(
        envsConfig,
        defaultBaseEnv,
      );
      const portsConfig = this.#processInstalls();

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
      set = { installs: [], allowedBuildDeps: {} };
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

  #mergeEnvs(keys: string[], childName: string) {
    const mergedVars = {} as Record<string, [string, string] | undefined>;
    const mergedInstalls = [] as InstallConfigFat[];
    const mergedOnEnterHooks = [];
    const mergedOnExitHooks = [];
    const mergedAllowedBuildDeps = {} as Record<
      string,
      [AllowedPortDep, string] | undefined
    >;
    for (const parentName of keys) {
      const { vars, installSetId, finalized } = this.finalizedEnvs[parentName];
      mergedOnEnterHooks.push(...finalized.onEnterHookTasks);
      mergedOnExitHooks.push(...finalized.onExitHookTasks);
      for (const [key, val] of Object.entries(vars)) {
        const conflict = mergedVars[key];
        // if parents share a parent themselves, they will have
        // the same item so it's not exactly a conflict
        if (conflict && val !== conflict[0]) {
          logger.warn(
            "environment variable conflict on multiple env inheritance, parent2 was chosen",
            {
              child: childName,
              parent1: conflict[1],
              parent2: parentName,
              variable: key,
            },
          );
        }
        mergedVars[key] = [val, parentName];
      }
      if (!installSetId) {
        continue;
      }
      const set = this.#installSets.get(installSetId)!;
      mergedInstalls.push(...set.installs);
      for (
        const [key, val] of Object.entries(set.allowedBuildDeps)
      ) {
        const conflict = mergedAllowedBuildDeps[key];
        if (conflict && !deep_eql(val, conflict[0])) {
          logger.warn(
            "allowedBuildDeps conflict on multiple env inheritance, parent2 was chosen",
            {
              child: childName,
              parent1: conflict[1],
              parent2: parentName,
              depPort: key,
            },
          );
        }
        mergedAllowedBuildDeps[key] = [val, parentName];
      }
    }
    const outInstallSet: InstallSet = {
      installs: mergedInstalls,
      allowedBuildDeps: Object.fromEntries(
        Object.entries(mergedAllowedBuildDeps).map((
          [key, val],
        ) => [key, val![0]]),
      ),
    };
    const outVars = Object.fromEntries(
      Object.entries(mergedVars).map(([key, val]) => [key, val![0]]),
    );
    return {
      installSet: outInstallSet,
      onEnterHookTasks: mergedOnEnterHooks,
      onExitHookTasks: mergedOnExitHooks,
      vars: outVars,
    };
  }

  #resolveEnvBases(parent: EnvParent, defaultBaseEnv: string, child?: string) {
    return typeof parent === "string"
      ? [parent]
      : (parent !== false) && defaultBaseEnv != child
      ? [defaultBaseEnv]
      : null;
  }

  /** this processes the defined envs, resolving inherit
   * relationships to produce the standard EnvsModuleConfig
   */
  #processEnvs(
    defaultEnv: string,
    defaultBaseEnv: string,
  ) {
    const all = {} as Record<
      string,
      ReturnType<EnvFinalizer> & { envBaseResolved: null | string[] }
    >;
    const indie = [] as string[];
    const revDeps = new Map<string, string[]>();
    for (
      const [_name, [_builder, finalizer]] of Object.entries(this.#seenEnvs)
    ) {
      const final = finalizer();
      const envBaseResolved = this.#resolveEnvBases(
        final.inherit,
        defaultBaseEnv,
        final.name,
      );
      all[final.name] = { ...final, envBaseResolved };
      if (envBaseResolved) {
        for (const base of envBaseResolved) {
          const parentRevDeps = revDeps.get(base);
          if (parentRevDeps) {
            parentRevDeps.push(final.name);
          } else {
            revDeps.set(base, [final.name]);
          }
        }
      } else {
        indie.push(final.name);
      }
    }

    const moduleConfig: EnvsModuleConfig = {
      envs: {},
      defaultEnv,
      envsNamed: [],
    };
    const workingSet = indie;
    while (workingSet.length > 0) {
      const item = workingSet.pop()!;
      const final = all[item];

      const base = this.#mergeEnvs(final.envBaseResolved ?? [], final.name);

      const finalVars = {
        ...base.vars,
        ...final.vars,
      };

      let finalInstallSetId: string | undefined;
      {
        const installSet = this.#installSets.get(final.installSetId);
        if (installSet) {
          installSet.installs.push(...base.installSet.installs);
          for (
            const [key, val] of Object.entries(base.installSet.allowedBuildDeps)
          ) {
            // prefer the port dep config of the child over any
            // similar deps in the base
            if (!installSet.allowedBuildDeps[key]) {
              installSet.allowedBuildDeps[key] = val;
            }
          }
          finalInstallSetId = final.installSetId;
        } // if there's no install set found under the id
        else {
          // implies that the env has not ports explicitly configured
          if (final.envBaseResolved) {
            // has a singluar parent
            if (final.envBaseResolved.length == 1) {
              finalInstallSetId =
                this.finalizedEnvs[final.envBaseResolved[0]].installSetId;
            } else {
              this.#installSets.set(final.installSetId, base.installSet);
            }
          }
        }
      }
      this.finalizedEnvs[final.name] = {
        installSetId: finalInstallSetId,
        vars: finalVars,
        finalized: final,
      };
      const hooks = [
        ...base.onEnterHookTasks.map(
          (key) => [key, "hook.onEnter.ghjkTask"] as const,
        ),
        ...final.onEnterHookTasks.map(
          (key) => [key, "hook.onEnter.ghjkTask"] as const,
        ),
        ...base.onExitHookTasks.map(
          (key) => [key, "hook.onExit.ghjkTask"] as const,
        ),
        ...final.onExitHookTasks.map(
          (key) => [key, "hook.onExit.ghjkTask"] as const,
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
            ty,
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
      // the actual final final recipe
      moduleConfig.envs[final.name] = {
        desc: final.desc,
        provides: [
          ...Object.entries(finalVars).map((
            [key, val],
          ) => {
            const prov: WellKnownProvision = { ty: "posix.envVar", key, val };
            return prov;
          }),
          // env hooks
          ...hooks,
        ],
      };
      if (finalInstallSetId) {
        const prov: InstallSetRefProvision = {
          ty: "ghjk.ports.InstallSetRef",
          setId: finalInstallSetId,
        };
        moduleConfig.envs[final.name].provides.push(prov);
      }

      // envs that have names which start with underscors
      // don't show up in the cli list
      if (!final.name.startsWith("_")) {
        moduleConfig.envsNamed.push(final.name);
      }

      const curRevDeps = revDeps.get(final.name);
      if (curRevDeps) {
        workingSet.push(...curRevDeps);
        revDeps.delete(final.name);
      }
    }
    // sanity checks
    if (revDeps.size > 0) {
      throw new Error(`working set empty but pending items found`, {
        cause: {
          revDeps,
          workingSet,
        },
      });
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
        const depKeys =
          (Array.isArray(args.dependsOn) ? args.dependsOn : [args.dependsOn])
            .map((nameOrKey) => nameToKey[nameOrKey] ?? nameOrKey);
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
    const gatheredEnvs = {} as Record<string, EnvRecipe>;
    const moduleConfig: TasksModuleConfig = {
      tasks: {},
      tasksNamed: [],
    };
    while (workingSet.length > 0) {
      const key = workingSet.pop()!;
      const args = this.#tasks.get(key)!;
      const { workingDir, desc, dependsOn, inherit } = args;

      const envBaseResolved = this.#resolveEnvBases(
        inherit,
        defaultBaseEnv,
      );
      const needsSeparateSet =
        // if task has installs itself
        args.installs?.length ||
        // task inherits from more than one parent
        (envBaseResolved && envBaseResolved.length > 1);

      // task only needs decalre a separate env
      // if it's overriding/adding something
      const needsSeparateEnv = needsSeparateSet || args.vars;

      let envKey: string | undefined;
      if (needsSeparateEnv) {
        const base = envBaseResolved
          ? this.#mergeEnvs(envBaseResolved, `____task_${args.name ?? key}`)
          : null;

        let installSetId: string | undefined;
        if (needsSeparateSet) {
          // we need to create a new install set
          const taskInstallSet: InstallSet = {
            installs: Array.isArray(args.installs)
              ? [...args.installs]
              : args.installs
              ? [args.installs]
              : [],
            allowedBuildDeps: Object.fromEntries(
              reduceAllowedDeps(args.allowedBuildDeps ?? []).map((
                dep,
              ) => [dep.manifest.name, dep]),
            ),
          };
          if (base) {
            taskInstallSet.installs.push(...base.installSet.installs);
            for (
              const [key, val] of Object.entries(
                base.installSet.allowedBuildDeps,
              )
            ) {
              // prefer the port dep config of the child over any
              // similar deps in the base
              if (!taskInstallSet.allowedBuildDeps[key]) {
                taskInstallSet.allowedBuildDeps[key] = val;
              }
            }
          }
          installSetId = `ghjkTaskInstSet___${
            objectHash(JSON.parse(JSON.stringify(taskInstallSet)))
          }`;
          this.#installSets.set(installSetId, taskInstallSet);
        } else if (envBaseResolved?.length == 1) {
          installSetId = this.finalizedEnvs[envBaseResolved[0]].installSetId;
        }

        const mergedEnvVars = {
          ...base?.vars,
          ...args.vars,
        };

        const taskEnvRecipe: EnvRecipe = {
          provides: [
            ...Object.entries(mergedEnvVars).map((
              [key, val],
            ) => {
              const prov: WellKnownProvision = {
                ty: "posix.envVar",
                key,
                val: val.toString(),
              };
              return prov;
            }),
          ],
        };
        if (installSetId) {
          const prov: InstallSetRefProvision = {
            ty: "ghjk.ports.InstallSetRef",
            setId: installSetId,
          };
          taskEnvRecipe.provides.push(prov);
        }

        const envHash = objectHash(JSON.parse(JSON.stringify(taskEnvRecipe)));
        gatheredEnvs[envHash] = taskEnvRecipe;
        envKey = envHash;
      } else if (envBaseResolved?.length == 1) {
        envKey = envBaseResolved[0];
      }

      const def: TaskDefHashed = {
        ty: args.ty,
        key,
        workingDir: typeof workingDir == "object"
          ? workingDir.toString()
          : workingDir,
        desc,
        ...dependsOn
          ? {
            dependsOn: (Array.isArray(dependsOn) ? dependsOn : [dependsOn])
              ?.map((keyOrHash) =>
                localToFinalKey[nameToKey[keyOrHash] ?? keyOrHash]
              ),
          }
          : {},
        envKey,
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

    // add the task envs to the envsModuleConfig
    for (const [hash, env] of Object.entries(gatheredEnvs)) {
      envsConfig.envs[hash] = env;
    }

    // reduce task based env hooks
    for (const [_name, env] of Object.entries(envsConfig.envs)) {
      env.provides = env.provides.map(
        (prov) => {
          if (
            prov.ty == "hook.onEnter.ghjkTask" ||
            prov.ty == "hook.onExit.ghjkTask"
          ) {
            const inlineProv = prov as InlineTaskHookProvision;
            const taskKey = localToFinalKey[inlineProv.taskKey];
            const out: WellKnownProvision = {
              ty: /onEnter/.test(prov.ty)
                ? "hook.onEnter.posixExec"
                : "hook.onExit.posixExec",
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

  #processInstalls() {
    const out: PortsModuleConfigHashed = {
      sets: {},
    };
    for (
      const [setId, set] of this.#installSets.entries()
    ) {
      out.sets[setId] = {
        installs: set.installs.map((inst) => this.#addToBlackboard(inst)),
        allowedDeps: this.#addToBlackboard(Object.fromEntries(
          Object.entries(set.allowedBuildDeps).map(
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
  inherit: string | string[] | boolean;
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
  #inherit: string | string[] | boolean = true;
  #vars: Record<string, string | number> = {};
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
      inherit: this.#inherit,
      vars: Object.fromEntries(
        Object.entries(this.#vars).map(([key, val]) => [key, val.toString()]),
      ),
      desc: this.#desc,
      onExitHookTasks: this.#onExitHookTasks,
      onEnterHookTasks: this.#onEnterHookTasks,
    }));
  }

  inherit(inherit: string | string[] | boolean) {
    this.#inherit = inherit;
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
   * Configure the build time deps allowed to be used by ports.
   * This is treated as a single set and will replace previously any configured set.
   */
  allowedBuildDeps(...deps: (AllowedPortDep | InstallConfigFat)[]) {
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
  vars(envVars: Record<string, string | number>) {
    Object.assign(
      this.#vars,
      unwrapParseRes(validators.envVars.safeParse(envVars), { envVars }),
    );
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
      ...reduceAllowedDeps([
        node.default(),
        cpy.default(),
      ]),
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
  ty: "hook.onExit.ghjkTask" | "hook.onEnter.ghjkTask";
  taskKey: string;
};

export function reduceAllowedDeps(
  deps: (AllowedPortDep | InstallConfigFat)[],
): AllowedPortDep[] {
  return deps.map(
    (dep: any) => {
      {
        const res = portsValidators.allowedPortDep.safeParse(dep);
        if (res.success) return res.data;
      }
      const inst = unwrapParseRes(
        portsValidators.installConfigFat.safeParse(dep),
        dep,
        "invalid allowed dep object, provide either InstallConfigFat or AllowedPortDep objects",
      );
      const out: AllowedPortDep = {
        manifest: inst.port,
        defaultInst: thinInstallConfig(inst),
      };
      return portsValidators.allowedPortDep.parse(out);
    },
  );
}
