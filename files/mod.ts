//! This provides the backing implementation of the GHjkfile frontends.

// NOTE: avoid adding sources of randomness
// here to make the resulting config reasonably stable
// across serializaiton. No random identifiers.

// ports specific imports
import portsValidators from "../modules/ports/types.ts";
import type {
  AllowedPortDep,
  InstallConfigFat,
  InstallSet,
  InstallSetRefProvision,
  PortsModuleConfigHashed,
  PortsModuleSecureConfig,
} from "../modules/ports/types.ts";
import logger from "../utils/logger.ts";
import {
  $,
  defaultCommandBuilder,
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
import { dax, jsonHash, objectHash } from "../deps/common.ts";
// WARN: this module has side-effects and only ever import
// types from it
import type { ExecTaskArgs } from "../modules/tasks/deno.ts";
import { TaskDefHashed, TasksModuleConfig } from "../modules/tasks/types.ts";
// envs
import {
  EnvRecipe,
  EnvsModuleConfig,
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
};

export type TaskFnArgs = {
  $: dax.$Type;
  argv: string[];
  env: Record<string, string>;
};

export type TaskFn = (args: TaskFnArgs) => Promise<any> | any;

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
  fn: TaskFn;
  /**
   * In order to key the right task when ghjk is requesting
   * execution of a specific task, we identify each using a hash.
   * The {@field fn} is `toString`ed in the hash input.
   * If a ghjkfile is produing identical tasks through a loop for
   * instance, it can provide a none to disambiguate beteween each
   * through hash differences.
   *
   * NOTE: the nonce must be stable across serialization.
   */
  nonce?: string;
};

type TaskDefTyped = DenoTaskDefArgs & { ty: "denoFile@v1" };

export class GhjkfileBuilder {
  #installSets = new Map<string, InstallSet>();
  #tasks = {} as Record<string, TaskDefTyped>;
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
    let hash;
    switch (args.ty) {
      case "denoFile@v1":
        hash = objectHash(jsonHash.canonicalize({
          ...args,
          // NOTE: we serialize the function to a string before
          // hashing.
          fn: args.fn.toString(),
        } as jsonHash.Tree));
        break;
      default:
        throw new Error(`unexpected task type: ${args.ty}`);
    }
    this.#tasks[hash] = {
      ...args,
    };
    return hash;
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
    return env;
  }

  async execTask(
    { key, workingDir, envVars, argv }: ExecTaskArgs,
  ) {
    const task = this.#tasks[key];
    if (!task) {
      throw new Error(`no task defined under "${key}"`);
    }
    const custom$ = $.build$({
      commandBuilder: defaultCommandBuilder().env(envVars).cwd(workingDir),
    });
    await task.fn({ argv, env: envVars, $: custom$ });
  }

  toConfig(
    { defaultEnv, defaultBaseEnv, secureConfig }: {
      defaultEnv: string;
      defaultBaseEnv: string;
      secureConfig: PortsModuleSecureConfig | undefined;
      ghjkfileUrl: string;
    },
  ) {
    try {
      const envsConfig = this.#processEnvs(defaultEnv, defaultBaseEnv);
      const tasksConfig = this.#processTasks(
        envsConfig,
        defaultBaseEnv,
      );
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
        : final.base
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
      moduleConfig.envs[final.name] = {
        desc: final.desc,
        provides: [
          ...Object.entries(processedVars).map((
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
    for (const [key, args] of Object.entries(this.#tasks)) {
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
    const keyToHash = {} as Record<string, string>;
    const moduleConfig: TasksModuleConfig = {
      envs: {},
      tasks: {},
      tasksNamed: {},
    };
    while (workingSet.length > 0) {
      const key = workingSet.pop()!;
      const args = this.#tasks[key];
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

      const envHash = objectHash(
        jsonHash.canonicalize(taskEnvRecipe as jsonHash.Tree),
      );
      moduleConfig.envs[envHash] = taskEnvRecipe;

      const def: TaskDefHashed = {
        ty: args.ty,
        key,
        workingDir: typeof workingDir == "object"
          ? workingDir.toString()
          : workingDir,
        desc,
        dependsOn: dependsOn?.map((keyOrHash) =>
          keyToHash[nameToKey[keyOrHash] ?? keyOrHash]
        ),
        envHash,
      };
      const taskHash = objectHash(jsonHash.canonicalize(def as jsonHash.Tree));
      moduleConfig.tasks[taskHash] = def;
      keyToHash[key] = taskHash;

      if (args.name) {
        moduleConfig.tasksNamed[args.name] = taskHash;
      }
      logger(import.meta).info("processed task", {
        name: args.name,
        dependsOn,
        mappedDO: def.dependsOn,
      });
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
};

// this class will be exposed to users and thus features
// a contrived implementation of the `build`/`finalize` method
// all to avoid exposing the function in the public api
export class EnvBuilder {
  #installSetId: string;
  #file: GhjkfileBuilder;
  #base: string | boolean = true;
  #vars: Record<string, string> = {};
  #desc?: string;

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
      base: this.#base,
      vars: this.#vars,
      desc: this.#desc,
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
