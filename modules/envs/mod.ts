/*
  Design:
    - `$ ghjk env activate` to switch to default environment
    - `$ ghjk env list`
    - `$ ghjk env info`
    - By default, all things go to the `main` environment
*/

export * from "./types.ts";

import { cliffy_cmd, zod } from "../../deps/cli.ts";
import { Json } from "../../utils/mod.ts";

import validators from "./types.ts";
import type { EnvsModuleConfigX } from "./types.ts";
import type { GhjkCtx, ModuleManifest } from "../types.ts";
import { ModuleBase } from "../mod.ts";

import { Blackboard } from "../../host/types.ts";

export type EnvsCtx = {};
const lockValidator = zod.object({
  version: zod.string(),
});
type EnvsLockEnt = zod.infer<typeof lockValidator>;

export class EnvsModule extends ModuleBase<EnvsCtx, EnvsLockEnt> {
  processManifest(
    _ctx: GhjkCtx,
    manifest: ModuleManifest,
    _bb: Blackboard,
    _lockEnt: EnvsLockEnt | undefined,
  ) {
    const res = validators.envsModuleConfig.safeParse(manifest.config);
    if (!res.success) {
      throw new Error("error parsing module config", {
        cause: {
          config: manifest.config,
          zodErr: res.error,
        },
      });
    }
    const config: EnvsModuleConfigX = {
      ...res.data,
    };

    return Promise.resolve({
      config,
    });
  }

  command(
    _gcx: GhjkCtx,
    _ecx: EnvsCtx,
  ) {
    const root: cliffy_cmd.Command<any, any, any, any> = new cliffy_cmd
      .Command()
      .alias("e")
      .action(function () {
        this.showHelp();
      })
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
