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
   */
  allowedBuildDeps?: (InstallConfigFat | AllowedPortDep)[];
  /**
   * Wether or not use the default set of allowed build dependencies.
   * If set, {@link enableRuntimes} is ignored but {@link allowedBuildDeps}
   * is still respected.
   * True by default.
   */
  stdDeps?: boolean;
  /**
   * (unstable) Allow runtimes from std deps to be used as build time dependencies.
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

export function file(
  args: FileArgs = {},
): {
  sophon: Readonly<object>;
  install: AddInstall;
  task: AddTask;
  env: AddEnv;
  config(args: SecureConfigArgs): void;
} {
  const defaultBuildDepsSet: AllowedPortDep[] = [];

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
      const dep
        of (args.stdDeps || args.stdDeps === undefined || args.stdDeps === null)
          ? stdDeps({ enableRuntimes: args.enableRuntimes ?? false })
          : []
    ) {
      if (seenPorts.has(dep.manifest.name)) {
        continue;
      }
      defaultBuildDepsSet.push(dep);
    }
  };

  // populate the bulid deps by the default args first
  replaceDefaultBuildDeps(args);

  const DEFAULT_BASE_ENV_NAME = "main";

  const file = new Ghjkfile();
  const mainEnv = file.addEnv({
    name: DEFAULT_BASE_ENV_NAME,
    inherit: false,
    installs: args.installs,
    // the default build deps will be used
    // as the allow set for the main env as well
    // NOTE: this approach allows the main env to
    // disassociate itself from the default set
    // if the user invokes `allowedBuildDeps`
    // on its EnvBuilder
    allowedBuildDeps: defaultBuildDepsSet,
    desc: "the default default environment.",
  });
  for (const env of args.envs ?? []) {
    file.addEnv(env);
  }
  for (const task of args.tasks ?? []) {
    file.addTask({ ...task, ty: "denoFile@v1" });
  }

  // FIXME: ses.lockdown to freeze primoridials
  // freeze the object to prevent malicious tampering of the secureConfig
  const sophon = Object.freeze({
    getConfig: Object.freeze(
      (
        ghjkfileUrl: string,
      ) => {
        return file.toConfig({
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
      (args: ExecTaskArgs) => file.execTask(args),
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
      return file.addTask({ ...args, ty: "denoFile@v1" });
    },

    env(
      nameOrArgs: string | EnvDefArgs,
      argsMaybe?: Omit<EnvDefArgs, "name">,
    ) {
      const args = typeof nameOrArgs == "object"
        ? nameOrArgs
        : { ...argsMaybe, name: nameOrArgs };
      return file.addEnv(args);
    },

    config(
      a: SecureConfigArgs,
    ) {
      replaceDefaultBuildDeps(a);
      args = {
        ...args,
        ...a,
      };
    },
  };
}
