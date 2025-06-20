export * from "./types.ts";

import { zod } from "./deps.ts";
import {
  $,
  detectShellPath,
  Json,
  promiseCollector,
  unwrapZodRes,
} from "../../deno_utils/mod.ts";
import validators from "./types.ts";
import type {
  EnvRecipe,
  EnvsModuleConfig,
  WellKnownProvision,
} from "./types.ts";
import type { Blackboard, GhjkCtx, ModuleManifest } from "../types.ts";
import { ModuleBase } from "../mod.ts";
import { cookPosixEnv } from "./posix.ts";
import { getPortsCtx, installGraphToSetMeta } from "../ports/inter.ts";
import type {
  InstallSetProvision,
  InstallSetRefProvision,
} from "../ports/types.ts";
import { buildInstallGraph, syncCtxFromGhjk } from "../ports/sync.ts";
import { getEnvsCtx } from "./inter.ts";
import { getTasksCtx } from "../tasks/inter.ts";
import type { CliCommand } from "../types.ts";

export type EnvsCtx = {
  activeEnv: string;
  keyToName: Record<string, string[] | undefined>;
  config: EnvsModuleConfig;
};

const lockValidator = zod.object({
  version: zod.string(),
});

type EnvsLockEnt = zod.infer<typeof lockValidator>;

export class EnvsModule extends ModuleBase<EnvsLockEnt> {
  override loadConfig(
    manifest: ModuleManifest,
    _bb: Blackboard,
    _lockEnt: EnvsLockEnt | undefined,
  ) {
    function unwrapParseCurry<I, O>(res: zod.SafeParseReturnType<I, O>) {
      return unwrapZodRes<I, O>(res, {
        id: manifest.id,
        config: manifest.config,
      }, "error parsing module config");
    }
    const config = unwrapParseCurry(
      validators.envsModuleConfig.safeParse(manifest.config),
    );
    const setEnv = Deno.env.get("GHJK_ENV");
    const activeEnv = setEnv && setEnv != "" ? setEnv : config.defaultEnv;

    const ecx = getEnvsCtx(this.gcx);
    ecx.activeEnv = activeEnv;
    ecx.config = config;
    for (const [name, key] of Object.entries(config.envsNamed)) {
      ecx.keyToName[key] = [name, ...(ecx.keyToName[key] ?? [])];
    }
  }

  override commands(): CliCommand[] {
    const gcx = this.gcx;
    const ecx = getEnvsCtx(this.gcx);

    function envKeyArgs(
      args: {
        taskKeyMaybe?: string;
        envKeyMaybe?: string;
      },
    ) {
      const { envKeyMaybe, taskKeyMaybe } = args;
      if (taskKeyMaybe && envKeyMaybe) {
        throw new Error(
          "--task-env option can not be combined with [envName] argument",
        );
      }
      if (taskKeyMaybe) {
        const tasksCx = getTasksCtx(gcx);
        const taskDef = tasksCx.config.tasks[taskKeyMaybe];
        if (!taskDef) {
          throw new Error(`no task found under key "${taskKeyMaybe}"`);
        }
        return { envKey: taskDef.envKey };
      }
      const actualKey = ecx.config.envsNamed[envKeyMaybe ?? ecx.activeEnv];
      return actualKey
        ? { envKey: actualKey, envName: envKeyMaybe ?? ecx.activeEnv }
        : { envKey: envKeyMaybe ?? ecx.activeEnv };
    }

    const commonFlags: CliCommand["flags"] = {
      taskEnv: {
        short: "t",
        long: "task-env",
        value_name: "TASK NAME",
        help: "Activate the environment used by the named task",
        exclusive: true,
      },
    };

    const commonArgs: CliCommand["args"] = {
      envKey: {
        value_name: "ENV KEY",
      },
    };

    return [
      {
        name: "envs",
        visible_aliases: ["e"],
        about: "Envs module, reproducable posix shells environments.",
        sub_commands: [
          {
            name: "ls",
            about: "List environments defined in the ghjkfile.",
            action: () => {
              // deno-lint-ignore no-console
              console.log(
                Object.entries(ecx.config.envsNamed)
                  // envs that have names which start with underscors
                  // don't show up in the cli list
                  .filter(([key]) => !key.startsWith("_"))
                  .map(([name, hash]) => {
                    const { desc } = ecx.config.envs[hash];
                    return `${name}${desc ? ": " + desc : ""}`;
                  })
                  .join("\n"),
              );
            },
          },
          {
            name: "activate",
            about: `Activate an environment.`,
            before_long_help:
              `- If no ENV KEY is specified and no env is currently active, this activates the configured default env [${ecx.config.defaultEnv}].`,
            flags: {
              ...commonFlags,
            },
            args: {
              ...commonArgs,
            },
            action: async function (
              {
                flags: { taskEnv: taskKeyMaybe },
                args: { envKey: envKeyMaybe },
              },
            ) {
              const { envKey } = envKeyArgs({
                taskKeyMaybe: taskKeyMaybe as string,
                envKeyMaybe: (Array.isArray(envKeyMaybe)
                  ? envKeyMaybe[0]
                  : envKeyMaybe) as string,
              });
              await activateEnv(envKey);
            },
          },
          {
            name: "cook",
            about: `Cooks the environment to a posix shell.`,
            before_long_help:
              `- If no ENV KEY is specified, this will cook the active env [${ecx.activeEnv}]`,
            flags: {
              ...commonFlags,
            },
            args: {
              ...commonArgs,
            },
            action: async function (
              {
                flags: { taskEnv: taskKeyMaybe },
                args: { envKey: envKeyMaybe },
              },
            ) {
              const { envKey, envName } = envKeyArgs({
                taskKeyMaybe: taskKeyMaybe as string,
                envKeyMaybe: (Array.isArray(envKeyMaybe)
                  ? envKeyMaybe[0]
                  : envKeyMaybe) as string,
              });
              await reduceAndCookEnv(gcx, ecx, envKey, envName ?? envKey);
            },
          },
          {
            name: "show",
            about: `Cooks the environment to a posix shell.`,
            before_long_help: `Show details about an environment.

- If no ENV KEY is specified, this shows details of the active env [${ecx.activeEnv}].
- If no ENV KEY is specified and no env is active, this shows details of the default env [${ecx.config.defaultEnv}].`,
            flags: {
              ...commonFlags,
            },
            args: {
              ...commonArgs,
            },
            action: async function (
              {
                flags: { taskEnv: taskKeyMaybe },
                args: { envKey: envKeyMaybe },
              },
            ) {
              const { envKey } = envKeyArgs({
                taskKeyMaybe: taskKeyMaybe as string,
                envKeyMaybe: (Array.isArray(envKeyMaybe)
                  ? envKeyMaybe[0]
                  : envKeyMaybe) as string,
              });
              const env = ecx.config.envs[envKey];
              if (!env) {
                throw new Error(`no env found under "${envKey}"`);
              }
              // deno-lint-ignore no-console
              console.log(
                $.inspect(
                  await showableEnv(
                    gcx,
                    env,
                    ecx.keyToName[envKey] ?? [envKey],
                  ),
                ),
              );
            },
          },
        ],
      },
      {
        name: "sync",
        about: "Synchronize your shell to what's in your config.",
        before_long_help: `Cooks and activates an environment.
- If no ENV KEY is specified and no env is currently active, this syncs the configured default env [${ecx.config.defaultEnv}].
- If the environment is already active, this doesn't launch a new shell.`,
        flags: {
          ...commonFlags,
        },
        args: {
          ...commonArgs,
        },
        action: async function (
          { flags: { taskEnv: taskKeyMaybe }, args: { envKey: envKeyMaybe } },
        ) {
          const { envKey, envName } = envKeyArgs({
            taskKeyMaybe: taskKeyMaybe as string,
            envKeyMaybe: (Array.isArray(envKeyMaybe)
              ? envKeyMaybe[0]
              : envKeyMaybe) as string,
          });
          await reduceAndCookEnv(
            gcx,
            ecx,
            envKey,
            envName ?? envKey,
          );
          await activateEnv(envKey);
        },
      },
    ];
  }

  loadLockEntry(raw: Json) {
    const entry = lockValidator.parse(raw);

    if (entry.version != "0") {
      throw new Error(`unexepected version tag deserializing lockEntry`);
    }

    return entry;
  }
  genLockEntry() {
    return {
      version: "0",
    };
  }
}

async function reduceAndCookEnv(
  gcx: GhjkCtx,
  ecx: EnvsCtx,
  envKey: string,
  envName: string,
) {
  const recipe = ecx.config.envs[envKey];
  if (!recipe) {
    throw new Error(`No env found under given name "${envKey}"`);
  }

  // TODO: diff env and ask confirmation from user
  const envDir = $.path(gcx.ghjkDir).join("envs", envKey);
  /*
  const recipeShowable = await showableEnv(gcx, recipe, envName);
  const oldRecipeShowable = {};
  {
    const recipeJsonPath = envDir.join("recipe.json");
    const oldRecipeRaw = await recipeJsonPath.readMaybeJson();

    if (oldRecipeRaw) {
      const oldRecipParsed = validators.envRecipe.safeParse(oldRecipeRaw);
      if (oldRecipParsed.success) {
        Object.assign(
          oldRecipeShowable,
          await showableEnv(gcx, oldRecipParsed.data, envName),
        );
      } else {
        logger.error(`invalid env recipe at ${recipeJsonPath}`);
      }
    }
  }
  console.log(
    diff_kit.diff(
      // TODO: canonicalize objects
      JSON.stringify(oldRecipeShowable, undefined, 2),
      JSON.stringify(recipeShowable, undefined, 2),
      // new diff_kit.DiffTerm(),
    ),
  );
  if (!await $.confirm("cook env?")) {
    return;
  }
  */
  await cookPosixEnv({
    gcx,
    recipe,
    envKey: envName,
    envDir: envDir.toString(),
    createShellLoaders: true,
  });
  if (envKey == ecx.config.defaultEnv) {
    const defaultEnvDir = $.path(gcx.ghjkDir).join("envs", "default");
    await $.removeIfExists(defaultEnvDir);
    await defaultEnvDir.symlinkTo(envDir, { kind: "relative" });
  }
  await $.co(
    Object
      .entries(ecx.config.envsNamed)
      .map(async ([name, key]) => {
        if (key == envKey) {
          const namedDir = $.path(gcx.ghjkDir).join("envs", name);
          await $.removeIfExists(namedDir);
          await namedDir.symlinkTo(envDir, { kind: "relative" });
        }
        if (name == ecx.config.defaultEnv || key == ecx.config.defaultEnv) {
          const defaultEnvDir = $.path(gcx.ghjkDir).join("envs", "default");
          await $.removeIfExists(defaultEnvDir);
          await defaultEnvDir.symlinkTo(envDir, { kind: "relative" });
        }
      }),
  );
}

async function showableEnv(
  gcx: GhjkCtx,
  recipe: EnvRecipe,
  envName: string[],
) {
  const printBag = {} as Record<string, any>;
  await using scx = await syncCtxFromGhjk(gcx);
  const promises = promiseCollector();
  for (
    const prov of recipe
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
      case "ghjk.ports.InstallSet": {
        promises.push(async () => {
          const graph = await buildInstallGraph(scx, prov.set);
          const setMeta = installGraphToSetMeta(graph);
          printBag.ports = {
            ...printBag.ports ?? {},
            [`installSet_${Math.floor(Math.random() * 101)}`]: setMeta,
          };
        });
        break;
      }
      case "ghjk.ports.InstallSetRef": {
        const portsCx = getPortsCtx(gcx);
        const set = portsCx.config.sets[prov.setId];
        if (!set) {
          throw new Error(
            `unable to find install set ref provisioned under id ${prov.setId}`,
          );
        }
        promises.push(async () => {
          const graph = await buildInstallGraph(scx, set);
          const setMeta = installGraphToSetMeta(graph);
          printBag.ports = {
            ...printBag.ports ?? {},
            [prov.setId]: setMeta,
          };
        });
        break;
      }
      default:
    }
  }
  await promises.finish();
  return {
    ...printBag,
    ...(recipe.desc ? { desc: recipe.desc } : {}),
    envName,
  };
}

async function activateEnv(envKey: string) {
  const nextfile = Deno.env.get("GHJK_NEXTFILE");
  if (nextfile) {
    await $.path(nextfile).writeText(envKey);
  } else {
    const shell = await detectShellPath();
    if (!shell) {
      throw new Error(
        "unable to detct shell in use. Use `--shell` flag to explicitly pass shell program.",
      );
    }
    // FIXME: the ghjk process will be around and consumer resources
    // with approach. Ideally, we'd detach the child and exit but this is blocked by
    // https://github.com/denoland/deno/issues/5501 is closed
    await $`${shell}`.env({ GHJK_ENV: envKey });
  }
}
