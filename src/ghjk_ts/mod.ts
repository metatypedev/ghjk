//! The primary import used by `ghjk.ts` ghjkfiles.

// TODO: harden most of the items in here

import "../deno_utils/setup_logger.ts";

// ports specific imports
import {
  type AllowedPortDep,
  type InstallConfigFat,
  reduceAllowedDeps,
} from "../sys_deno/ports/types.ts";
import logger from "../deno_utils/logger.ts";
import { $ } from "../deno_utils/mod.ts";
import { EnvBuilder, Ghjkfile, stdDeps } from "./file.ts";
import type { DenoTaskDefArgs, EnvDefArgs, TaskFn } from "./file.ts";
import type { ExecTaskArgs } from "../sys_deno/tasks/types.ts";

export type { DenoTaskDefArgs, EnvDefArgs, TaskFn } from "./file.ts";
export { $, logger, stdDeps };

export type AddEnv = {
  (args: EnvDefArgs): EnvBuilder;
  (name: string, args?: Omit<EnvDefArgs, "name">): EnvBuilder;
};

/**
 * Provision a port install in the `main` env.
 */
export type AddInstall = {
  (...configs: InstallConfigFat[]): void;
};

/**
 * Define and register a task.
 */
export type AddTask = {
  (args: DenoTaskDefArgs): string;
  (name: string, args: Omit<DenoTaskDefArgs, "name">): string;
  (fn: TaskFn, args?: Omit<DenoTaskDefArgs, "fn">): string;
  (
    name: string,
    fn: TaskFn,
    args?: Omit<DenoTaskDefArgs, "fn" | "name">,
  ): string;
};

/**
 * Define and register multiple tasks.
 */
export type AddTasks = {
  (args: (DenoTaskDefArgs | TaskFn)[]): string[];
  (args: Record<string, TaskFn | Omit<DenoTaskDefArgs, "name">>): string[];
};

export type FileArgs = {
  /**
   * The env to activate by default. When entering the working
   * directory for example.
   */
  defaultEnv?: string;
  /**
   * The default env all envs inherit from.
   */
  defaultBaseEnv?: string;
  /**
   * Additional ports that can be used as build time dependencies.
   *
   * This applies to the `defaultBaseEnv` env.
   */
  allowedBuildDeps?: (InstallConfigFat | AllowedPortDep)[];
  /**
   * Wether or not use the default set of allowed build dependencies.
   * If set, {@link enableRuntimes} is ignored but {@link allowedBuildDeps}
   * is still respected.
   * True by default.
   *
   * This applies to the `defaultBaseEnv` env.
   */
  stdDeps?: boolean;
  /**
   * (unstable) Allow runtimes from std deps to be used as build time dependencies.
   *
   * This applies to the `defaultBaseEnv` env.
   */
  enableRuntimes?: boolean;
  /**
   * Installs to add to the main env.
   */
  installs?: InstallConfigFat[];
  /**
   * Tasks to expose to the CLI.
   */
  tasks?: Record<string, Omit<DenoTaskDefArgs, "name"> | TaskFn>;
  /**
   * Different envs available to the CLI.
   */
  envs?: EnvDefArgs[];
};

type SecureConfigArgs = Omit<
  FileArgs,
  "envs" | "tasks" | "installs"
>;

type DenoFileKnobs = {
  sophon: Readonly<object>;
  /**
   * {@inheritDoc AddInstall}
   */
  install: AddInstall;
  /**
   * {@inheritDoc AddTask}
   */
  task: AddTask;
  /**
   * {@inheritDoc AddTasks}
   */
  tasks: AddTasks;
  /**
   * {@inheritDoc AddEnv}
   */
  env: AddEnv;
  /**
   * Configure global and miscallenous ghjk settings.
   */
  config(args: SecureConfigArgs): void;
};

const builder = new Ghjkfile();
// We need this in the module scope since
// both sophon.getConfig and setupGhjkts
// need to access it
let args: FileArgs | undefined;

const DEFAULT_BASE_ENV_NAME = "main";
/**
 * The sophon is the actual proxy between the host world
 * and the ghjkfile world.
 */
export const sophon = Object.freeze({
  // FIXME: ses.lockdown to freeze primoridials
  // freeze the object to prevent malicious tampering of the secureConfig
  getConfig: Object.freeze(
    (
      ghjkfileUrl: string,
    ) => {
      if (!args) {
        logger().warn(
          "ghjk.ts has not called the `file` function even once.",
        );
      }
      return builder.toConfig({
        ghjkfileUrl,
        defaultEnv: args?.defaultEnv ?? DEFAULT_BASE_ENV_NAME,
        defaultBaseEnv: args?.defaultBaseEnv ??
          DEFAULT_BASE_ENV_NAME,
      });
    },
  ),
  execTask: Object.freeze(
    // TODO: do we need to source the default base env from
    // the secure config here?
    (args: ExecTaskArgs) => builder.execTask(args),
  ),
});

function setupGhjkts(
  fileArgs: FileArgs = {},
): DenoFileKnobs {
  const defaultBuildDepsSet: AllowedPortDep[] = [];

  args = fileArgs;

  const mainEnv = builder.addEnv(DEFAULT_BASE_ENV_NAME, {
    name: DEFAULT_BASE_ENV_NAME,
    inherit: args.defaultBaseEnv && args.defaultBaseEnv != DEFAULT_BASE_ENV_NAME
      ? args.defaultBaseEnv
      : false,
    desc: "the default default environment.",
  });

  if (args.defaultBaseEnv) {
    builder.addEnv(args.defaultBaseEnv, {
      name: args.defaultBaseEnv,
      inherit: false,
      installs: args.installs,
    });
  } else {
    if (args.installs) {
      mainEnv.install(...args.installs);
    }
  }

  // this replaces the allowedBuildDeps contents according to the
  // args. Written to be called multilple times to allow
  // replacement.
  const replaceDefaultBuildDeps = (args: SecureConfigArgs) => {
    // empty out the array first
    defaultBuildDepsSet.length = 0;
    defaultBuildDepsSet.push(
      ...reduceAllowedDeps(args.allowedBuildDeps ?? []),
    );
    const seenPorts = new Set(
      defaultBuildDepsSet.map((dep) => dep.manifest.name),
    );
    // if the user explicitly passes a port config, we let
    // it override any ports of the same kind from the std library
    for (
      const dep of args.stdDeps !== false // i.e.e true if undefined
        ? stdDeps({ enableRuntimes: args.enableRuntimes ?? false })
        : []
    ) {
      if (seenPorts.has(dep.manifest.name)) {
        continue;
      }
      defaultBuildDepsSet.push(dep);
    }
    // we override the allowedBuildDeps of the
    // defaultEnvBase each time `file` or `env` are used
    if (args.defaultBaseEnv) {
      builder.addEnv(args.defaultBaseEnv, {
        allowedBuildDeps: defaultBuildDepsSet,
      });
    } else {
      mainEnv.allowedBuildDeps(...defaultBuildDepsSet);
    }
  };

  // populate the bulid deps by the default args first
  replaceDefaultBuildDeps(args);

  for (const env of args.envs ?? []) {
    builder.addEnv(env.name, env);
  }
  for (const [name, def] of Object.entries(args.tasks ?? {})) {
    builder.addTask({
      name,
      ...(typeof def == "function" ? { fn: def } : def),
      ty: "denoFile@v1",
    });
  }

  function task(
    nameOrArgsOrFn: string | DenoTaskDefArgs | TaskFn,
    argsOrFn?: Omit<DenoTaskDefArgs, "name"> | TaskFn,
    argsMaybe?: Omit<DenoTaskDefArgs, "fn" | "name">,
  ) {
    let args: DenoTaskDefArgs;
    // support for single deet object
    if (typeof nameOrArgsOrFn == "object") {
      args = nameOrArgsOrFn;
    } // support for named functions or anon tasks or func and details
    else if (typeof nameOrArgsOrFn == "function") {
      args = {
        ...(
          // support for named functions only format
          typeof nameOrArgsOrFn == "function" && nameOrArgsOrFn.name != ""
            ? { name: nameOrArgsOrFn.name }
            : {}
        ),
        ...(argsOrFn ?? {}),
        fn: nameOrArgsOrFn,
      };
    } // support for first arg being name
    else if (typeof argsOrFn == "object") {
      args = { ...argsOrFn, name: nameOrArgsOrFn };
    } // support for name, function, deets
    else if (argsOrFn) {
      args = {
        ...(argsMaybe ?? {}),
        name: nameOrArgsOrFn,
        fn: argsOrFn,
      };
    } else {
      args = {
        name: nameOrArgsOrFn,
      };
    }
    return builder.addTask({ ...args, ty: "denoFile@v1" });
  }
  // we return a bunch of functions here
  // to ease configuring the main environment
  // including overloads
  return {
    sophon,

    install(...configs: InstallConfigFat[]) {
      mainEnv.install(...configs);
    },

    task,

    tasks(
      defs:
        | (DenoTaskDefArgs | TaskFn)[]
        | Record<string, TaskFn | Omit<DenoTaskDefArgs, "name">>,
    ) {
      if (Array.isArray(defs)) {
        return defs.map((def) => task(def));
      } else {
        return Object.entries(defs).map(([key, val]) => task(key, val));
      }
    },

    env(
      nameOrArgs: string | EnvDefArgs,
      argsMaybe?: Omit<EnvDefArgs, "name">,
    ) {
      const args = typeof nameOrArgs == "object"
        ? nameOrArgs
        : { ...argsMaybe, name: nameOrArgs };
      return builder.addEnv(args.name, args);
    },

    config(
      newArgs: SecureConfigArgs,
    ) {
      if (
        newArgs.defaultBaseEnv !== undefined ||
        newArgs.enableRuntimes !== undefined ||
        newArgs.allowedBuildDeps !== undefined ||
        newArgs.stdDeps !== undefined
      ) {
        replaceDefaultBuildDeps(newArgs);
      }
      if (
        newArgs.defaultBaseEnv &&
        newArgs.defaultBaseEnv != DEFAULT_BASE_ENV_NAME
      ) {
        mainEnv.inherit(newArgs.defaultBaseEnv);
      }
      // NOTE:we're deep mutating the global args from above
      args = {
        ...newArgs,
      };
    },
  };
}

let fileCreated = false;
const exitFn = Deno.exit;
let firstCaller: string | undefined;

export const file = Object.freeze(function file(
  fileArgs: FileArgs = {},
): DenoFileKnobs {
  const caller = getCaller();
  if (fileCreated) {
    logger().error(
      `double \`file\` invocation detected detected at ${caller} after being first called at ${firstCaller}.` +
        ` A ghjkfile can only invoke \`file\` once, exiting.`,
    );
    exitFn(1);
  }
  fileCreated = true;
  firstCaller = caller;
  return setupGhjkts(fileArgs);
});

// lifted from https://github.com/apiel/caller/blob/ead98/caller.ts
// MIT License 2020 Alexander Piel
interface Bind {
  cb?: (file: string) => string;
}
// deno-lint-ignore no-explicit-any
function getCaller(this: Bind | any, levelUp = 3) {
  const err = new Error();
  const stack = err.stack?.split("\n")[levelUp];
  if (stack) {
    return getFile.bind(this)(stack);
  }
  // deno-lint-ignore no-explicit-any
  function getFile(this: Bind | any, stack: string): string {
    stack = stack.substring(stack.indexOf("at ") + 3);
    if (!stack.startsWith("file://")) {
      stack = stack.substring(stack.lastIndexOf("(") + 1);
    }
    const path = stack.split(":");
    let file;
    if (Deno.build.os == "windows") {
      file = `${path[0]}:${path[1]}:${path[2]}`;
    } else {
      file = `${path[0]}:${path[1]}`;
    }

    const cb = (this as Bind)?.cb;
    if (cb) {
      file = cb(file);
    }
    return file;
  }
}
