//! This module is intended to be re-exported by `ghjk.ts` config scripts. Please
//! avoid importing elsewhere at it has side-effects.

// TODO: harden most of the items in here

import "./setup_logger.ts";

import { zod } from "./deps/common.ts";
// ports specific imports
import portsValidators from "./modules/ports/types.ts";
import type {
  AllowedPortDep,
  InstallConfigFat,
} from "./modules/ports/types.ts";
import logger from "./utils/logger.ts";
import { $, thinInstallConfig } from "./utils/mod.ts";
import { EnvBuilder, Ghjkfile, stdDeps } from "./files/mod.ts";
import type { DenoTaskDefArgs, EnvDefArgs, TaskFn } from "./files/mod.ts";
// WARN: this module has side-effects and only ever import
// types from it
import type { ExecTaskArgs } from "./modules/tasks/deno.ts";

const DEFAULT_BASE_ENV_NAME = "main";

const file = new Ghjkfile();
const mainEnv = file.addEnv({
  name: DEFAULT_BASE_ENV_NAME,
  inherit: false,
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
      secureConfig: DenoFileSecureConfig | undefined,
    ) => {
      const defaultEnv = secureConfig?.defaultEnv ?? DEFAULT_BASE_ENV_NAME;
      const defaultBaseEnv = secureConfig?.defaultBaseEnv ??
        DEFAULT_BASE_ENV_NAME;
      return file.toConfig({
        defaultEnv,
        defaultBaseEnv,
        ghjkfileUrl,
        masterPortDepAllowList: secureConfig?.masterPortDepAllowList ??
          stdDeps(),
      });
    },
  ),
  execTask: Object.freeze(
    // TODO: do we need to source the default base env from
    // the secure config here?
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
export function task(
  name: string,
  fn: TaskFn,
  args?: Omit<DenoTaskDefArgs, "fn" | "name">,
): string;
export function task(fn: TaskFn, args?: Omit<DenoTaskDefArgs, "fn">): string;
export function task(
  nameOrArgsOrFn: string | DenoTaskDefArgs | TaskFn,
  argsOrFn?: Omit<DenoTaskDefArgs, "name"> | TaskFn,
  argsMaybe?: Omit<DenoTaskDefArgs, "fn" | "name">,
): string {
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

const denoFileSecureConfig = zod.object({
  masterPortDepAllowList: zod.array(portsValidators.allowedPortDep).nullish(),
  // TODO: move into envs/types
  defaultEnv: zod.string().nullish(),
  defaultBaseEnv: zod.string().nullish(),
});
/*
 * This is a secure sections of the config intended to be direct exports
 * from the config script instead of the global variable approach the
 * main [`GhjkConfig`] can take.
 */
export type DenoFileSecureConfig = zod.input<
  typeof denoFileSecureConfig
>;
export type DenoFileSecureConfigX = zod.input<
  typeof denoFileSecureConfig
>;

function stdSecureConfig(
  args: {
    additionalAllowedPorts?: (InstallConfigFat | AllowedPortDep)[];
    enableRuntimes?: boolean;
  } & Pick<DenoFileSecureConfig, "defaultEnv" | "defaultBaseEnv">,
) {
  const { additionalAllowedPorts, enableRuntimes = false } = args;
  const out: DenoFileSecureConfig = {
    ...args,
    masterPortDepAllowList: [
      ...stdDeps({ enableRuntimes }),
      ...additionalAllowedPorts?.map(
        (dep: any) => {
          const res = portsValidators.allowedPortDep.safeParse(dep);
          if (res.success) return res.data;
          const out: AllowedPortDep = {
            manifest: dep.port,
            defaultInst: thinInstallConfig(dep),
          };
          return portsValidators.allowedPortDep.parse(out);
        },
      ) ?? [],
    ],
  };
  return out;
}
