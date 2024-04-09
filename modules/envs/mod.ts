export * from "./types.ts";

import { cliffy_cmd, zod } from "../../deps/cli.ts";
import { $, detectShellPath, Json, unwrapParseRes } from "../../utils/mod.ts";

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
    return {
      envs: new cliffy_cmd
        .Command()
        .description("Envs module, reproducable posix shells environments.")
        .alias("e")
        // .alias("env")
        .action(function () {
          this.showHelp();
        })
        .command(
          "ls",
          new cliffy_cmd.Command()
            .description("List environments defined in the ghjkfile.")
            .action(() => {
              console.log(
                Object.entries(ecx.config.envs)
                  .map(([name, { desc }]) =>
                    `${name}${desc ? ": " + desc : ""}`
                  )
                  .join("\n"),
              );
            }),
        )
        .command(
          "activate",
          new cliffy_cmd.Command()
            .description(`Activate an environment.

- If no [envName] is specified and no env is currently active, this activates the configured default env [${ecx.config.defaultEnv}].`)
            .arguments("[envName:string]")
            .option(
              "--shell <shell>",
              "The shell to use. Tries to detect the current shell if not provided.",
            )
            .action(async function ({ shell: shellMaybe }, envNameMaybe) {
              const shell = shellMaybe ?? await detectShellPath();
              if (!shell) {
                throw new Error(
                  "unable to detct shell in use. Use `--shell` flag to explicitly pass shell program.",
                );
              }
              const envName = envNameMaybe ?? ecx.config.defaultEnv;
              // FIXME: the ghjk process will be around and consumer resources
              // with approach. Ideally, we'd detach the child and exit but this is blocked by
              // https://github.com/denoland/deno/issues/5501 is closed
              await $`${shell}`
                .env({ GHJK_ENV: envName });
            }),
        )
        .command(
          "cook",
          new cliffy_cmd.Command()
            .description(`Cooks the environment to a posix shell.

- If no [envName] is specified, this will cook the active env [${ecx.activeEnv}]`)
            .arguments("[envName:string]")
            .action(async function (_void, envNameMaybe) {
              const envName = envNameMaybe ?? ecx.activeEnv;
              await reduceAndCookEnv(gcx, ecx, envName);
            }),
        )
        .command(
          "show",
          new cliffy_cmd.Command()
            .description(`Show details about an environment.

- If no [envName] is specified, this shows details of the active env [${ecx.activeEnv}].
- If no [envName] is specified and no env is active, this shows details of the default env [${ecx.config.defaultEnv}].
        `)
            .arguments("[envName:string]")
            .action(function (_void, envNameMaybe) {
              const envName = envNameMaybe ?? ecx.activeEnv;
              if (!ecx.config.envs[envName]) {
                throw new Error(`No env found under given name "${envName}"`);
              }
              printEnvInfo(gcx, ecx, envName);
            }),
        ),
      sync: new cliffy_cmd.Command()
        .description(`Cooks and activates an environment.

- If no [envName] is specified and no env is currently active, this syncs the configured default env [${ecx.config.defaultEnv}].
- If the environment is already active, this doesn't launch a new shell.`)
        .arguments("[envName:string]")
        .option(
          "--shell <shell>",
          "The shell to use. Tries to detect the current shell if not provided.",
        )
        .action(async function ({ shell: shellMaybe }, envNameMaybe) {
          const shell = shellMaybe ?? await detectShellPath();
          if (!shell) {
            throw new Error(
              "unable to detct shell in use. Use `--shell` flag to explicitly pass shell program.",
            );
          }
          const envName = envNameMaybe ?? ecx.activeEnv;
          await reduceAndCookEnv(gcx, ecx, envName);
          if (ecx.activeEnv != envName) {
            await $`${shell}`.env({ GHJK_ENV: envName });
          }
        }),
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

async function reduceAndCookEnv(
  gcx: GhjkCtx,
  ecx: EnvsCtx,
  envName: string,
) {
  const env = ecx.config.envs[envName];
  if (!env) {
    throw new Error(`No env found under given name "${envName}"`);
  }

  // TODO: diff env and ask confirmation from user
  const reducedEnv = await reduceStrangeProvisions(gcx, env);
  const envDir = $.path(gcx.ghjkDir).join("envs", envName);

  await cookPosixEnv(reducedEnv, envName, envDir.toString(), true);
  if (envName == ecx.config.defaultEnv) {
    const defaultEnvDir = $.path(gcx.ghjkDir).join("envs", "default");
    await $.removeIfExists(defaultEnvDir);
    await defaultEnvDir.createSymlinkTo(envDir, { kind: "relative" });
  }
}

function printEnvInfo(
  gcx: GhjkCtx,
  ecx: EnvsCtx,
  envName: string,
) {
  const env = ecx.config.envs[envName];
  const printBag = {} as Record<string, any>;
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
  console.log(Deno.inspect(
    {
      ...printBag,
      ...(env.desc ? { desc: env.desc } : {}),
      envName,
    },
    {
      depth: 10,
      colors: isColorfulTty(),
    },
  ));
}
