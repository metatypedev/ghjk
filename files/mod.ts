//! This provides the backing implementation of the Ghjkfile frontends.

// NOTE: avoid adding sources of randomness
// here to make the resulting config reasonably stable
// across repeated serializaitons. No random identifiers.

import { deep_eql, multibase32, multibase64, zod } from "../deps/common.ts";

// ports specific imports
import portsValidators from "../modules/ports/types.ts";
import type {
  AllowedPortDep,
  InstallConfigFat,
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
  unwrapZodRes,
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
import {
  DynamicPosixDirProvision,
  type EnvRecipe,
  type EnvsModuleConfig,
  PosixDirProvision,
  PosixDirProvisionType,
  type Provision,
  type WellKnownProvision,
} from "../modules/envs/types.ts";
import envsValidators from "../modules/envs/types.ts";
import modulesValidators from "../modules/types.ts";
import { ParentEnvs } from "./MergedEnvs.ts";

const validators = {
  envVars: zod.record(
    modulesValidators.envVarName,
    zod.union([zod.string(), zod.number()]),
  ),
};

export type EnvParent = string | string[] | boolean | undefined;

export type EnvDefArgs = {
  name: string;
  installs?: InstallConfigFat | InstallConfigFat[];
  allowedBuildDeps?: (InstallConfigFat | AllowedPortDep)[];
  /**
   * If true or not set, will base the task's env on top
   * of the default env (usually `main`).
   * Will be a standalone env if false.
   * If given a string, will use the identified env as a base
   * for the task env.
   * If given a set of strings, will inherit from each.
   * If conflict is detected during multiple inheritance, the
   * item from the env specified at a higher index will override.
   */
  inherit?: EnvParent;
  desc?: string;
  vars?: Record<string, string | number>;
  execDirs?: string[];
  sharedLibDirs?: string[];
  headerDirs?: string[];
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
  vars?: Record<string, string | number>; // TODO: add DynEnvValue?
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
   * instance, it can provide a nonce to disambiguate between each
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

export type FinalizedEnvs = {
  finalized: ReturnType<EnvFinalizer>;
  installSetId?: string;
  vars: Record<string, string>;
  dynVars: Record<string, string>;
  envHash: string;
};

export class Ghjkfile {
  #installSets = new Map<
    string,
    { installs: Set<string>; allowedBuildDeps: Record<string, string> }
  >();
  #seenInstallConfs = new Map<string, InstallConfigFat>();
  #seenAllowedDepPorts = new Map<string, AllowedPortDep>();
  #tasks = new Map<string, TaskDefTyped>();
  #bb = new Map<string, unknown>();
  #seenEnvs: Record<string, [EnvBuilder, EnvFinalizer]> = {};
  #finalizedEnvs: Record<string, FinalizedEnvs> = {};

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
    const config = unwrapZodRes(
      portsValidators.installConfigFat.safeParse(configUnclean),
      {
        config: configUnclean,
      },
      `error parsing InstallConfig`,
    );

    const hash = objectHashSafe(config);
    this.#seenInstallConfs.set(hash, config);
    const set = this.#getSet(setId);
    set.installs.add(hash);
  }

  setAllowedPortDeps(
    setId: string,
    deps: (InstallConfigFat | AllowedPortDep)[],
  ) {
    const set = this.#getSet(setId);
    set.allowedBuildDeps = Object.fromEntries(
      reduceAllowedDeps(deps).map((
        dep,
      ) => {
        const hash = objectHashSafe(dep);
        this.#seenAllowedDepPorts.set(hash, dep);
        return [dep.manifest.name, hash];
      }),
    );
  }

  addTask(args: TaskDefTyped) {
    // FIXME: combine the task env processing
    // with normal env processing
    // we currrently process task envs at once in the end
    // to do env deduplication
    if (args.vars) {
      args.vars = unwrapZodRes(validators.envVars.safeParse(args.vars), {
        vars: args.vars,
      });
    }
    let key = args.name;
    if (!key) {
      switch (args.ty) {
        case "denoFile@v1": {
          const { fn, workingDir, ...argsRest } = args;
          key = objectHashSafe({
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
          });
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

  addEnv(key: string, args: EnvDefArgsPartial) {
    let env = this.#seenEnvs[key]?.[0];
    if (!env) {
      let finalizer: EnvFinalizer;
      env = new EnvBuilder(
        this,
        (fin) => {
          finalizer = fin;
        },
        key,
        args.name,
      );
      this.#seenEnvs[key] = [env, finalizer!];
    }
    if ("inherit" in args) {
      env.inherit(args.inherit!);
    }
    if (args.installs) {
      env.install(
        ...(Array.isArray(args.installs) ? args.installs : [args.installs]),
      );
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
    if (args.execDirs) {
      for (const dir of args.execDirs) {
        env.execDir(dir);
      }
    }
    if (args.sharedLibDirs) {
      for (const dir of args.sharedLibDirs) {
        env.sharedLibDir(dir);
      }
    }
    if (args.headerDirs) {
      for (const dir of args.headerDirs) {
        env.headerDir(dir);
      }
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
      const custom$ = task$(
        argv,
        envVars,
        workingDir,
        `<task:${task.name ?? key}>`,
      );
      return await task.fn(custom$, {
        argv,
        env: Object.freeze(envVars),
        $: custom$,
        workingDir,
      });
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
    this.addEnv(defaultEnv, { name: defaultEnv });
    this.addEnv(defaultBaseEnv, { name: defaultBaseEnv });

    // crearte the envs used by the tasks
    const taskToEnvMap = {} as Record<string, string>;
    for (
      const [key, { inherit, vars, installs, allowedBuildDeps }] of this.#tasks
        .entries()
    ) {
      const envKey = `____task_env_${key}`;
      this.addEnv(envKey, {
        inherit,
        vars,
        installs,
        allowedBuildDeps,
      });
      taskToEnvMap[key] = envKey;
    }

    try {
      const envsConfig = this.#processEnvs(
        defaultEnv,
        defaultBaseEnv,
        taskToEnvMap,
      );
      const tasksConfig = this.#processTasks(
        envsConfig,
        taskToEnvMap,
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
      logger.error(`error constructing config for serialization`, { cause });
      throw new Error(`error constructing config for serialization`, { cause });
    }
  }

  #getSet(setId: string) {
    let set = this.#installSets.get(setId);
    if (!set) {
      set = { installs: new Set(), allowedBuildDeps: {} };
      this.#installSets.set(setId, set);
    }
    return set;
  }

  #addToBlackboard(inp: unknown) {
    // jsonHash.digest is async
    const hash = objectHashSafe(inp);

    if (!this.#bb.has(hash)) {
      this.#bb.set(hash, inp);
    }
    return hash;
  }

  #mergeEnvs(keys: string[], childName: string) {
    const parentEnvs = new ParentEnvs(childName);
    for (const parentName of keys) {
      const { installSetId, vars, dynVars, finalized } =
        this.#finalizedEnvs[parentName];
      parentEnvs.addHooks(
        finalized.onEnterHookTasks,
        finalized.onExitHookTasks,
      );
      parentEnvs.mergeVars(parentName, vars);
      parentEnvs.mergeDynVars(parentName, dynVars);
      if (installSetId) {
        const set = this.#installSets.get(installSetId)!;
        parentEnvs.mergeInstalls(
          parentName,
          set.installs,
          set.allowedBuildDeps,
        );
      }
    }

    return parentEnvs.finalize();
  }

  #resolveEnvBases(
    parent: EnvParent,
    taskToEnvMap: Record<string, string>,
    defaultBaseEnv: string,
    childKey: string,
  ) {
    if (parent === false) {
      return [];
    }
    if (parent === true || parent === undefined || parent === null) {
      return childKey != defaultBaseEnv ? [defaultBaseEnv] : [];
    }
    const inheritSet = typeof parent == "string"
      ? [parent]
      : parent
      ? [...new Set(parent)] // js sets preserve insert order
      : [];

    const swapJobs = [] as [number, string][];
    for (let ii = 0; ii < inheritSet.length; ii++) {
      const parentKey = inheritSet[ii];
      // parent env exists
      // note: env inheritances take prioritiy over
      // tasks of the same name
      if (this.#seenEnvs[parentKey]) {
        //noop
      } else if (this.#tasks.has(parentKey)) {
        // while the ghjkfile only refers to the task envs
        // by the task name, we must use the private task
        // env key for inheritance resolution
        // the swap job take cares of that
        swapJobs.push([ii, taskToEnvMap[parentKey]] as const);
      } else {
        throw new Error(
          `env "${childKey}" inherits from "${parentKey} but no env or task found under key"`,
        );
      }
    }
    for (const [idx, envKey] of swapJobs) {
      inheritSet[idx] = envKey;
    }
    return inheritSet;
  }

  /** this processes the defined envs, resolving inherit
   * relationships to produce the standard EnvsModuleConfig
   */
  #processEnvs(
    defaultEnv: string,
    defaultBaseEnv: string,
    taskToEnvMap: Record<string, string>,
  ) {
    const all = {} as Record<
      string,
      ReturnType<EnvFinalizer> & { envBaseResolved: null | string[] }
    >;
    const indie = [] as string[];
    const deps = new Map<string, string[]>();
    const revDeps = new Map<string, string[]>();
    for (
      const [_key, [_builder, finalizer]] of Object.entries(this.#seenEnvs)
    ) {
      const final = finalizer();

      const envBaseResolved = this.#resolveEnvBases(
        final.inherit,
        taskToEnvMap,
        defaultBaseEnv,
        final.key,
      );
      all[final.key] = { ...final, envBaseResolved };
      if (envBaseResolved.length > 0) {
        deps.set(final.key, [...envBaseResolved]);
        for (const base of envBaseResolved) {
          const parentRevDeps = revDeps.get(base);
          if (parentRevDeps) {
            parentRevDeps.push(final.key);
          } else {
            revDeps.set(base, [final.key]);
          }
        }
      } else {
        indie.push(final.key);
      }
    }

    const moduleConfig: EnvsModuleConfig = {
      envs: {},
      defaultEnv,
      envsNamed: {},
    };
    const workingSet = indie;
    // console.log({
    //   indie,
    //   deps,
    // });
    while (workingSet.length > 0) {
      const item = workingSet.pop()!;
      const final = all[item];

      const base = this.#mergeEnvs(final.envBaseResolved ?? [], final.key);
      // console.log({ parents: final.envBaseResolved, child: final.key, base });

      const finalVars = {
        ...base.vars,
        ...final.vars,
      };
      const finalDynVars = {
        ...base.dynVars,
        ...final.dynVars,
      };

      let finalInstallSetId: string | undefined;
      {
        const installSet = this.#installSets.get(final.installSetId);
        if (installSet) {
          installSet.installs = installSet.installs
            .union(base.installSet.installs);
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
                this.#finalizedEnvs[final.envBaseResolved[0]].installSetId;
            } else {
              this.#installSets.set(final.installSetId, base.installSet);
              finalInstallSetId = final.installSetId;
            }
          }
        }
      }
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
      const recipe: EnvRecipe = {
        desc: final.desc,
        provides: [
          ...Object.entries(finalVars).map((
            [key, val],
          ) => {
            const prov: WellKnownProvision = { ty: "posix.envVar", key, val };
            return prov;
          }),
          ...Object.entries(finalDynVars).map((
            [key, val],
          ) => {
            const prov = { ty: "posix.envVarDyn", key, taskKey: val };
            return unwrapZodRes(
              envsValidators.envVarDynProvision.safeParse(prov),
              prov,
            );
          }),
          ...final.posixDirs,
          ...final.dynamicPosixDirs,
          // env hooks
          ...hooks,
        ],
      };

      if (finalInstallSetId) {
        const prov: InstallSetRefProvision = {
          ty: "ghjk.ports.InstallSetRef",
          setId: finalInstallSetId,
        };
        recipe.provides.push(prov);
      }

      // hashing takes care of deduplication
      const envHash = objectHashSafe(recipe);
      this.#finalizedEnvs[final.key] = {
        installSetId: finalInstallSetId,
        vars: finalVars,
        dynVars: finalDynVars,
        finalized: final,
        envHash,
      };
      // hashing takes care of deduplication
      moduleConfig.envs[envHash] = recipe;

      if (final.name) {
        moduleConfig.envsNamed[final.name] = envHash;
      }

      for (const revDepKey of revDeps.get(final.key) ?? []) {
        const revDepDeps = deps.get(revDepKey)!;
        // swap remove
        const idx = revDepDeps.indexOf(final.key);
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
    // sanity checks
    if (deps.size > 0) {
      throw new Error(`working set empty but pending items found`, {
        cause: {
          deps,
          workingSet,
          revDeps,
        },
      });
    }
    return moduleConfig;
  }

  #processTasks(
    envsConfig: EnvsModuleConfig,
    taskToEnvMap: Record<string, string>,
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
    const moduleConfig: TasksModuleConfig = {
      tasks: {},
      tasksNamed: [],
    };
    while (workingSet.length > 0) {
      const key = workingSet.pop()!;
      const args = this.#tasks.get(key)!;
      const { workingDir, desc, dependsOn } = args;

      const envKey = taskToEnvMap[key];
      const { envHash } = this.#finalizedEnvs[envKey];

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
        envKey: envHash,
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
        installs: [...set.installs.values()]
          .map((instHash) =>
            this.#addToBlackboard(this.#seenInstallConfs.get(instHash))
          ),
        allowedBuildDeps: this.#addToBlackboard(Object.fromEntries(
          Object.entries(set.allowedBuildDeps).map(
            (
              [key, depHash],
            ) => [
              key,
              this.#addToBlackboard(this.#seenAllowedDepPorts.get(depHash)),
            ],
          ),
        )),
      };
    }
    return out;
  }
}

type EnvFinalizer = () => {
  key: string;
  name?: string;
  installSetId: string;
  inherit: string | string[] | boolean;
  vars: Record<string, string>;
  dynVars: Record<string, string>;
  posixDirs: Array<PosixDirProvision>;
  dynamicPosixDirs: Array<DynamicPosixDirProvision>;
  desc?: string;
  onEnterHookTasks: string[];
  onExitHookTasks: string[];
};

export type EnvDefArgsPartial =
  & { name?: string }
  & Omit<EnvDefArgs, "name">;

export type DynEnvValue =
  | ((...params: Parameters<TaskFn>) => string | number)
  | ((...params: Parameters<TaskFn>) => Promise<string | number>);

export type DynamicPathVarFn =
  | ((...params: Parameters<TaskFn>) => string)
  | ((...params: Parameters<TaskFn>) => Promise<string>);

//
// /**
//  * A version of {@link EnvDefArgs} that has all container
//  * fields guratneed initialized to non null but possible empty values.
//  */
// export type EnvDefArgsReqiured =
//   & Required<Omit<EnvDefArgs, "name" | "desc">>
//   & Partial<Pick<EnvDefArgs, "name" | "desc">>;
//
// export function envDef(
//   args: EnvDefArgsPartial,
// ): EnvDefArgsReqiured;
// export function envDef(
//   name: string,
//   args?: Omit<EnvDefArgs, "name">,
// ): EnvDefArgsReqiured;
// export function envDef(
//   nameOrArgs: string | EnvDefArgsPartial,
//   argsMaybe?: Omit<EnvDefArgs, "name">,
// ): EnvDefArgsReqiured {
//   const args = typeof nameOrArgs == "object"
//     ? nameOrArgs
//     : { ...argsMaybe, name: nameOrArgs };
//   return {
//     ...args,
//     installs: [],
//     inherit: args.inherit ?? [],
//     vars: args.vars ?? {},
//     onExit: args.onExit ?? [],
//     onEnter: args.onEnter ?? [],
//     allowedBuildDeps: args.allowedBuildDeps ?? [],
//   };
// }

/**
 this class will be exposed to users and thus features
 a contrived implementation of the `build`/`finalize` method
 all to avoid exposing the function in the public api
 */
export class EnvBuilder {
  #installSetId: string;
  #file: Ghjkfile;
  #inherit: string | string[] | boolean = true;
  #vars: Record<string, string | number> = {};
  #dynVars: Record<string, string> = {};
  #posixDirs: Array<PosixDirProvision> = [];
  #dynamicPosixDirs: Array<DynamicPosixDirProvision> = [];
  #desc?: string;
  #onEnterHookTasks: string[] = [];
  #onExitHookTasks: string[] = [];

  constructor(
    file: Ghjkfile,
    setFinalizer: (fin: EnvFinalizer) => void,
    public readonly key: string,
    public name?: string,
  ) {
    this.#file = file;
    this.#installSetId = `ghjkEnvProvInstSet___${key}`;
    setFinalizer(() => ({
      key: this.key,
      name: this.name,
      installSetId: this.#installSetId,
      inherit: this.#inherit,
      vars: Object.fromEntries(
        Object.entries(this.#vars).map(([key, val]) => [key, val.toString()]),
      ),
      dynVars: this.#dynVars,
      posixDirs: this.#posixDirs,
      dynamicPosixDirs: this.#dynamicPosixDirs,
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
  var(key: string, val: string | DynEnvValue) {
    this.vars({ [key]: val });
    return this;
  }

  /**
   * Add multiple environment variable.
   */
  vars(envVars: Record<string, string | number | DynEnvValue>) {
    const vars = {}, dynVars = {};
    for (const [k, v] of Object.entries(envVars)) {
      switch (typeof v) {
        case "string":
        case "number":
          Object.assign(vars, { [k]: v });
          break;
        case "function": {
          const taskKey = this.#file.addTask({
            ty: "denoFile@v1",
            fn: v,
            nonce: k,
          });
          Object.assign(dynVars, { [k]: taskKey });
          break;
        }
        default:
          throw new Error(
            `environment value of type "${typeof v}" is not supported`,
          );
      }
    }

    Object.assign(
      this.#vars,
      unwrapZodRes(validators.envVars.safeParse(vars), { envVars: vars }),
    );
    Object.assign(
      this.#dynVars,
      dynVars,
    );
    return this;
  }

  /**
   * Add a directory to the path environment variable
   * $PATH, $LD_LIBRARY_PATH, $INCLUDE_PATH, etc.
   */
  posixDir(type: PosixDirProvisionType, val: string | DynamicPathVarFn) {
    switch (typeof val) {
      case "string": {
        const prov = { ty: type, path: val };
        this.#posixDirs.push(unwrapZodRes(
          envsValidators.posixDirProvision.safeParse(prov),
          prov,
        ));
        break;
      }

      case "function": {
        const taskKey = this.#file.addTask({
          ty: "denoFile@v1",
          fn: val,
        });
        const prov = { ty: type + ".dynamic", taskKey };
        this.#dynamicPosixDirs.push(unwrapZodRes(
          envsValidators.dynamicPosixDirProvision.safeParse(prov),
          prov,
        ));
        break;
      }

      default:
        throw new Error(`type "${typeof val}" is not supported for path`);
    }

    return this;
  }

  execDir(val: string | DynamicPathVarFn) {
    return this.posixDir("posix.execDir", val);
  }
  sharedLibDir(val: string | DynamicPathVarFn) {
    return this.posixDir("posix.sharedLibDir", val);
  }
  headerDir(val: string | DynamicPathVarFn) {
    return this.posixDir("posix.headerDir", val);
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

  mixin(
    setup: (
      builder: EnvBuilder,
      ghjk: { task(args: DenoTaskDefArgs): void },
    ) => void,
  ) {
    setup(this, {
      task: (args) => {
        return this.#file.addTask({ ...args, ty: "denoFile@v1" });
      },
    });
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
  loggerName: string,
) {
  const custom$ = Object.assign(
    // NOTE: order is important on who assigns to who
    // here
    $.build$({
      commandBuilder: defaultCommandBuilder().env(env).cwd(workingDir),
    }),
    {
      argv,
      env: Object.freeze(env),
      workingDir: $.path(workingDir),
      logger: getLogger(loggerName),
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
      const inst = unwrapZodRes(
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

function objectHashSafe(obj: unknown) {
  return objectHash(JSON.parse(JSON.stringify(obj)));
}
