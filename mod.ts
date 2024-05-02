//! This module is intended to be re-exported by `ghjk.ts` config scripts. Please
//! avoid importing elsewhere at it has side-effects.

// TODO: harden most of the items in here

import "./setup_logger.ts";

// ports specific imports
import type {
  InstallConfigFat,
  PortsModuleSecureConfig,
} from "./modules/ports/types.ts";
import logger from "./utils/logger.ts";
import { $ } from "./utils/mod.ts";
import { EnvBuilder, Ghjkfile, stdDeps, stdSecureConfig } from "./files/mod.ts";
import type { DenoTaskDefArgs, EnvDefArgs, TaskFn } from "./files/mod.ts";
// WARN: this module has side-effects and only ever import
// types from it
import type { ExecTaskArgs } from "./modules/tasks/deno.ts";

const DEFAULT_BASE_ENV_NAME = "main";

const file = new Ghjkfile();
const mainEnv = file.addEnv({
  name: DEFAULT_BASE_ENV_NAME,
  base: false,
  allowedPortDeps: stdDeps(),
  desc: "the default default environment.",
});

export type { DenoTaskDefArgs, EnvDefArgs, TaskFn } from "./files/mod.ts";
export { $, logger, stdDeps, stdSecureConfig };

// FIXME: ses.lockdown to freeze primoridials
// freeze the object to prevent malicious tampering of the secureConfig
export const ghjk = Object.freeze({
  getConfig: Object.freeze(
    (
      ghjkfileUrl: string,
      secureConfig: PortsModuleSecureConfig | undefined,
    ) => {
      const defaultEnv = secureConfig?.defaultEnv ?? DEFAULT_BASE_ENV_NAME;
      const defaultBaseEnv = secureConfig?.defaultBaseEnv ??
        DEFAULT_BASE_ENV_NAME;
      return file.toConfig({
        defaultEnv,
        defaultBaseEnv,
        secureConfig,
        ghjkfileUrl,
      });
    },
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

/**
 * Define and register a task.
 */
export function task(args: DenoTaskDefArgs): string;
export function task(name: string, args: Omit<DenoTaskDefArgs, "name">): string;
export function task(name: string, fn: TaskFn): string;
export function task(fn: TaskFn): string;
export function task(
  nameOrArgsOrFn: string | DenoTaskDefArgs | TaskFn,
  argsOrFn?: Omit<DenoTaskDefArgs, "name"> | TaskFn,
): string {
  let args: DenoTaskDefArgs;
  if (typeof nameOrArgsOrFn == "object") {
    args = nameOrArgsOrFn;
  } else if (typeof nameOrArgsOrFn == "function") {
    args = {
      fn: nameOrArgsOrFn,
    };
  } else if (typeof argsOrFn == "object") {
    args = { ...argsOrFn, name: nameOrArgsOrFn };
  } else if (argsOrFn) {
    args = {
      name: nameOrArgsOrFn,
      fn: argsOrFn,
    };
  } else {
    throw new Error("no function provided when defining task");
  }
  return file.addTask({ ...args, ty: "denoFile@v1" });
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
