/*
  Design:
    - `$ ghjk env activate` to switch to default environment
    - `$ ghjk envs list`
    - `$ ghjk envs info`
    - `$ ghjk env activate` - activate default environment
    - `$ ghjk env activate $name` - activate $name environment
    - `$ ghjk env src` - activate default environment
    - `$ ghjk env src $name` - activate $name environment
    - `$ ghjk env cook` - cooks default environment
    - `$ ghjk env cook $name` - cooks $name environment
    - `$ ghjk sync` - activates and cooks default environment
    - `$ ghjk sync $name` - activates and cooks $name environment
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
import { isColorfulTty } from "../../utils/logger.ts";

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

    const activeEnv = Deno.env.get("GHJK_ENV") ?? config.defaultEnv;

    return Promise.resolve({
      activeEnv,
      config,
    });
  }

  commands(
    gcx: GhjkCtx,
    ecx: EnvsCtx,
  ) {
    const commands = {
      src: new cliffy_cmd.Command()
        .description(`Activate an environment.
If invoked without any arguments, this will activate the default env [${ecx.config.defaultEnv}]`)
        .arguments("[envName:string]")
        .action(async function (_void, envName) {
          $`fish `.env().spawn();
        }),

      cook: new cliffy_cmd.Command()
        .description(`Cooks the environment to a posix shell.
If invoked without any arguments, this will cook the active env [${ecx.activeEnv}]`)
        .arguments("[envName:string]")
        .action(async function (_void, envNameMaybe) {
          const envName = envNameMaybe ?? ecx.activeEnv;
          const env = ecx.config.envs[envName];
          if (!env) {
            throw new Error(`No env found under given name "${envName}"`);
          }

          // TODO: diff env and ask confirmation from user
          const reducedEnv = await reduceStrangeProvisions(gcx, env);
          const envDir = $.path(gcx.ghjkDir).join("envs", envName).toString();

          await cookPosixEnv(reducedEnv, envDir, true);
        }),

      ls: new cliffy_cmd.Command()
        .description("List environments defined in the ghjkfile.")
        .action(() => {
          console.log(
            Object.entries(ecx.config.envs)
              .map(([name, { desc }]) => `${name}${desc ? ": " + desc : ""}`)
              .join("\n"),
          );
        }),

      show: new cliffy_cmd.Command()
        .description(`Show details about an environment.
If invoked without any arguments, this will show info of the active env [${ecx.activeEnv}].
        `)
        .arguments("[envName:string]")
        .action(function (_void, envNameMaybe) {
          const envName = envNameMaybe ?? ecx.activeEnv;
          if (!ecx.config.envs[envName]) {
            throw new Error(`No env found under given name "${envName}"`);
          }
          printEnvInfo(gcx, ecx, envName);
        }),
    };
    for (const [envName, { desc }] of Object.entries(ecx.config.envs)) {
      const cmd = new cliffy_cmd.Command()
        .action(function () {
          printEnvInfo(gcx, ecx, envName);
        });
      if (desc) {
        cmd.description(desc);
      }
      commands.show.command(envName, cmd);
    }
    const root = new cliffy_cmd
      .Command()
      .description("Envs module, reproducable posix shells environments.")
      .alias("e")
      // .alias("env")
      .action(function () {
        this.showHelp();
      });
    for (const [name, cmd] of Object.entries(commands)) {
      root.command(name, cmd);
    }
    return {
      envs: root,
    };
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

function printEnvInfo(
  gcx: GhjkCtx,
  ecx: EnvsCtx,
  envName: string,
) {
  const env = ecx.config.envs[envName];
  const printBag = {
    envName,
    ...(env.desc ? { desc: env.desc } : {}),
  } as Record<string, any>;
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
          [`installSet_${Math.floor(Math.random() * 101)}`]: prov.set,
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
  console.log(Deno.inspect(printBag, {
    depth: 10,
    colors: isColorfulTty(),
  }));
}
