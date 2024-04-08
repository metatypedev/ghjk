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
import type { EnvsModuleConfigX, WellKnownProvision } from "./types.ts";
import type { GhjkCtx, ModuleManifest } from "../types.ts";
import { ModuleBase } from "../mod.ts";

import { Blackboard } from "../../host/types.ts";
import { reduceStrangeProvisions } from "./reducer.ts";
import { cookPosixEnv } from "./posix.ts";
import { getInstallSetMetaStore } from "../ports/inter.ts";
import type {
  InstallSetProvision,
  InstallSetRefProvision,
} from "../ports/types.ts";

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

    const activeEnv = Deno.env.get("GHJK_ACTIVE_ENV") ?? config.defaultEnv;

    return Promise.resolve({
      activeEnv,
      config,
    });
  }

  command(
    gcx: GhjkCtx,
    ecx: EnvsCtx,
  ) {
    const printEnvInfo = (name: string) => {
      const env = ecx.config.envs[name];
      const printBag = { name } as Record<string, any>;
      for (
        const prov of env
          .provides as (
            | WellKnownProvision
            | InstallSetRefProvision
            | InstallSetProvision
          )[]
      ) {
        switch (prov.ty) {
          case "posix.envVar":
            printBag.envVars = {
              ...printBag.envVars ?? {},
              [prov.key]: prov.val,
            };
            break;
          case "posix.exec":
            printBag.execs = [
              ...printBag.execs ?? [],
              prov.absolutePath,
            ];
            break;
          case "posix.sharedLib":
            printBag.sharedLibs = [
              ...printBag.sharedLibs ?? [],
              prov.absolutePath,
            ];
            break;
          case "posix.headerFile":
            printBag.headerFiles = [
              ...printBag.headerFiles ?? [],
              prov.absolutePath,
            ];
            break;
          case "ghjk.ports.InstallSet":
            // TODO: display raw install sets
            printBag.ports = {
              ...printBag.ports ?? {},
              [`installSet_${Math.floor(Math.random() * 100)}`]: prov.set,
            };
            break;
          case "ghjk.ports.InstallSetRef": {
            const installSetMetaStore = getInstallSetMetaStore(gcx);
            printBag.ports = {
              ...printBag.ports ?? {},
              [prov.setId]: installSetMetaStore.get(prov.setId),
            };
            break;
          }
          default:
        }
      }
      console.log(Deno.inspect(printBag));
    };

    const commands = {
      sync: new cliffy_cmd.Command()
        .description("Syncs the environment.")
        .action(async function () {
          const envName = ecx.activeEnv;

          const env = ecx.config.envs[envName];
          // TODO: diff env and ask confirmation from user
          const reducedEnv = await reduceStrangeProvisions(gcx, env);
          const envDir = $.path(gcx.ghjkDir).join("envs", envName).toString();

          await cookPosixEnv(reducedEnv, envDir, true);
        }),
      ls: new cliffy_cmd.Command()
        .description("List environments defined in the ghjkfile.")
        .action(() => {
          console.log(Object.keys(ecx.config.envs).join("\n"));
        }),
      info: new cliffy_cmd.Command()
        .description(`Show details about an environment.
If invoked without any arguments, this will show the info of the active env [${ecx.activeEnv}].
        `)
        .action(function () {
          printEnvInfo(ecx.activeEnv);
        }),
    };
    for (const name of Object.keys(ecx.config.envs)) {
      commands.info.command(
        name,
        new cliffy_cmd.Command()
          .action(function () {
            printEnvInfo(name);
          }),
      );
    }
    const root = new cliffy_cmd
      .Command()
      .description("Envs module, reproducable unix shells environments.")
      .alias("e")
      .alias("env")
      .action(function () {
        this.showHelp();
      });
    for (const [name, cmd] of Object.entries(commands)) {
      root.command(name, cmd);
    }
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
