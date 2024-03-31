/*
  Design:
    - `$ ghjk env activate` to switch to default environment
    - `$ ghjk env list`
    - `$ ghjk env info`
    - By default, all things go to the `main` environment
*/

export * from "./types.ts";

import { cliffy_cmd, zod } from "../../deps/cli.ts";
import { $, Json, unwrapParseRes } from "../../utils/mod.ts";

import validators from "./types.ts";
import type { EnvsModuleConfigX } from "./types.ts";
import type { GhjkCtx, ModuleManifest } from "../types.ts";
import { ModuleBase } from "../mod.ts";

import { Blackboard } from "../../host/types.ts";
import { reduceStrangeProvisions } from "./reducer.ts";
import { cookPosixEnv } from "./posix.ts";

export type EnvsCtx = {
  activeEnv: string;
  config: EnvsModuleConfigX;
};

const lockValidator = zod.object({
  version: zod.string(),
});

type EnvsLockEnt = zod.infer<typeof lockValidator>;

export class EnvsModule extends ModuleBase<EnvsCtx, EnvsLockEnt> {
  processManifest(
    _ctx: GhjkCtx,
    manifest: ModuleManifest,
    bb: Blackboard,
    _lockEnt: EnvsLockEnt | undefined,
  ) {
    function unwrapParseCurry<I, O>(res: zod.SafeParseReturnType<I, O>) {
      return unwrapParseRes<I, O>(res, {
        id: manifest.id,
        config: manifest.config,
        bb,
      }, "error parsing module config");
    }
    const config = unwrapParseCurry(
      validators.envsModuleConfig.safeParse(manifest.config),
    );

    const activeEnv = config.defaultEnv;

    return Promise.resolve({
      activeEnv,
      config,
    });
  }

  command(
    gcx: GhjkCtx,
    ecx: EnvsCtx,
  ) {
    const root: cliffy_cmd.Command<any, any, any, any> = new cliffy_cmd
      .Command()
      .description("Envs module, the cornerstone")
      .alias("e")
      .alias("env")
      .action(function () {
        this.showHelp();
      })
      .command(
        "sync",
        new cliffy_cmd.Command().description("Syncs the environment.")
          .action(async () => {
            const envName = ecx.activeEnv;

            const env = ecx.config.envs[envName];
            // TODO: diff env and ask confirmation from user
            const reducedEnv = await reduceStrangeProvisions(gcx, env);
            const envDir = $.path(gcx.ghjkDir).join("envs", envName).toString();

            await cookPosixEnv(reducedEnv, envDir, true);
          }),
      )
      .description("Envs module.");
    return root;
  }

  loadLockEntry(
    _gcx: GhjkCtx,
    raw: Json,
  ) {
    const entry = lockValidator.parse(raw);

    if (entry.version != "0") {
      throw new Error(`unexepected version tag deserializing lockEntry`);
    }

    return entry;
  }
  genLockEntry(
    _gcx: GhjkCtx,
    _tcx: EnvsCtx,
  ) {
    return {
      version: "0",
    };
  }
}
