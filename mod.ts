//! This module is intended to be re-exported by `ghjk.ts` config scripts.

// TODO: harden most of the items in here

import "./setup_logger.ts";

// ports specific imports
import type {
  AllowedPortDep,
  InstallConfigFat,
} from "./modules/ports/types.ts";
import logger from "./utils/logger.ts";
import { $ } from "./utils/mod.ts";
import {
  EnvBuilder,
  Ghjkfile,
  reduceAllowedDeps,
  stdDeps,
} from "./files/mod.ts";
import type { DenoTaskDefArgs, EnvDefArgs, TaskFn } from "./files/mod.ts";
// WARN: this module has side-effects and only ever import
// types from it
import type { ExecTaskArgs } from "./modules/tasks/deno.ts";

export type { DenoTaskDefArgs, EnvDefArgs, TaskFn } from "./files/mod.ts";
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
  tasks?: DenoTaskDefArgs[];
  /**
   * Different envs availaible to the CLI.
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
   * {@inheritdoc AddInstall}
   */
  install: AddInstall;
  /**
   * {@inheritdoc AddTask}
   */
  task: AddTask;
  /**
   * {@inheritDoc AddEnv}
   */
  env: AddEnv;
  /**
   * Configure global and miscallenous ghjk settings.
   */
  config(args: SecureConfigArgs): void;
};

export const file = Object.freeze(function file(
  args: FileArgs = {},
): DenoFileKnobs {
  const defaultBuildDepsSet: AllowedPortDep[] = [];

  const DEFAULT_BASE_ENV_NAME = "main";

  const builder = new Ghjkfile();
  const mainEnv = builder.addEnv(DEFAULT_BASE_ENV_NAME, {
    name: DEFAULT_BASE_ENV_NAME,
    inherit: false,
    installs: args.installs,
    desc: "the default default environment.",
  });

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
  for (const task of args.tasks ?? []) {
    builder.addTask({ ...task, ty: "denoFile@v1" });
  }

  // FIXME: ses.lockdown to freeze primoridials
  // freeze the object to prevent malicious tampering of the secureConfig
  const sophon = Object.freeze({
    getConfig: Object.freeze(
      (
        ghjkfileUrl: string,
      ) => {
        return builder.toConfig({
          ghjkfileUrl,
          defaultEnv: args.defaultEnv ?? DEFAULT_BASE_ENV_NAME,
          defaultBaseEnv: args.defaultBaseEnv ??
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

  // we return a bunch of functions here
  // to ease configuring the main environment
  // including overloads
  return {
    sophon,

    install(...configs: InstallConfigFat[]) {
      mainEnv.install(...configs);
    },

    task(
      nameOrArgsOrFn: string | DenoTaskDefArgs | TaskFn,
      argsOrFn?: Omit<DenoTaskDefArgs, "name"> | TaskFn,
      argsMaybe?: Omit<DenoTaskDefArgs, "fn" | "name">,
    ) {
      let args: DenoTaskDefArgs;
      if (typeof nameOrArgsOrFn == "object") {
        args = nameOrArgsOrFn;
      } else if (typeof nameOrArgsOrFn == "function") {
        args = {
          ...(argsOrFn ?? {}),
          fn: nameOrArgsOrFn,
        };
      } else if (typeof argsOrFn == "object") {
        args = { ...argsOrFn, name: nameOrArgsOrFn };
      } else if (argsOrFn) {
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
      // NOTE:we're deep mutating the first args from above
      args = {
        ...newArgs,
      };
    },
  };
});
