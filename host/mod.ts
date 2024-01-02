import { zod } from "../deps/common.ts";
import { cliffy_cmd } from "../deps/cli.ts";
import logger, { isColorfulTty } from "../utils/logger.ts";

import { $, envDirFromConfig, JSONValue, PathRef } from "../utils/mod.ts";
import validators from "./types.ts";
import * as std_modules from "../modules/std.ts";
import * as deno from "./deno.ts";
import type { ModuleBase } from "../modules/mod.ts";
import { GhjkCtx } from "../modules/types.ts";
import portValidators from "../modules/ports/types.ts";

export interface CliArgs {
  ghjkDir: string;
  configPath: string;
}

export async function cli(args: CliArgs) {
  const configPath = $.path(args.configPath).resolve().normalize().toString();
  const ghjkDir = $.path(args.ghjkDir).resolve().normalize().toString();
  const envDir = envDirFromConfig(ghjkDir, configPath);

  logger().debug({ configPath, envDir });

  const ctx = { ghjkDir, configPath, envDir };

  const { subCommands, serializedConfig } = await readConfig(ctx);

  let cmd: cliffy_cmd.Command<any, any, any, any> = new cliffy_cmd.Command()
    .name("ghjk")
    .version("0.1.1") // FIXME: better way to resolve version
    .description("Programmable runtime manager.")
    .action(function () {
      this.showHelp();
    })
    .command(
      "print",
      new cliffy_cmd.Command()
        .description("Emit different discovored and built values to stdout.")
        .action(function () {
          this.showHelp();
        })
        .command(
          "ghjk-dir-path",
          new cliffy_cmd.Command()
            .description("Print the path where ghjk is installed in.")
            .action(function () {
              console.log(ghjkDir);
            }),
        )
        .command(
          "config-path",
          new cliffy_cmd.Command()
            .description("Print the path of the ghjk.ts used")
            .action(function () {
              console.log(configPath);
            }),
        )
        .command(
          "config",
          new cliffy_cmd.Command()
            .description(
              "Print the extracted ans serialized config from the ghjk.ts file",
            )
            .action(function () {
              console.log(Deno.inspect(serializedConfig, {
                depth: 10,
                colors: isColorfulTty(),
              }));
            }),
        )
        .command(
          "env-dir-path",
          new cliffy_cmd.Command()
            .description(
              "Print the directory the current config's env is housed in.",
            )
            .action(function () {
              console.log(envDir);
            }),
        ),
    )
    .command(
      "deno",
      new cliffy_cmd.Command()
        .description("Access the deno cli used by ghjk.")
        .useRawArgs()
        .action(async function (_, ...args) {
          logger().debug(args);
          await $.raw`${Deno.execPath()} ${args}`
            .env("DENO_EXEC_PATH", Deno.execPath());
        }),
    );

  for (const [name, subcmd] of Object.entries(subCommands)) {
    cmd = cmd.command(name, subcmd);
  }
  await cmd
    .command("completions", new cliffy_cmd.CompletionsCommand())
    .parse(Deno.args);
}

async function readConfig(ctx: GhjkCtx) {
  const configPath = $.path(ctx.configPath);
  const configFileStat = await configPath.stat();
  // FIXME: subset of ghjk commands should be functional
  // even if config file not found
  if (!configFileStat) {
    throw new Error("unable to locate config file", {
      cause: ctx,
    });
  }
  const lockFilePath = configPath
    .parentOrThrow()
    .join("ghjk.lock");

  const subCommands = {} as Record<string, cliffy_cmd.Command>;

  const lockFileStat = await lockFilePath.stat();
  // if no lockfile found or if it's older than the config file
  if (lockFileStat && lockFileStat.mtime! > configFileStat.mtime!) {
    logger().info("using lockfile", lockFilePath);
    const lockObj = await readLockFile(lockFilePath);
    // TODO: figure out cross platform lockfiles :O
    if (
      lockObj.version == "0" &&
      lockObj.platform[0] == Deno.build.os &&
      lockObj.platform[1] == Deno.build.arch
    ) {
      const serializedConfig = lockObj.source;
      for (const [id, entry] of Object.entries(lockObj.moduleEntries)) {
        const mod = std_modules.map[id];
        if (!mod) {
          throw new Error(`unrecognized module specified by lockfile: ${id}`);
        }
        const instance: ModuleBase<unknown> = new mod.ctor();
        const pMan = await instance.loadLockEntry(
          ctx,
          entry as JSONValue,
        );
        subCommands[id] = instance.command(ctx, pMan);
      }
      return { subCommands, serializedConfig };
    } else {
      logger().warning(
        "lockfile not fit for curreng ghjk build, reserializing",
      );
    }
  }

  logger().info("serializing ghjkfile", configPath);
  const serializedConfig = await readAndSerializeConfig(configPath);
  const lockObj: zod.infer<typeof lockObjValidator> = {
    version: "0",
    platform: [Deno.build.os, Deno.build.arch],
    source: serializedConfig,
    moduleEntries: {} as Record<string, unknown>,
  };
  for (const man of serializedConfig.modules) {
    const mod = std_modules.map[man.id];
    if (!mod) {
      throw new Error(`unrecognized module specified by ghjk.ts: ${man.id}`);
    }
    const instance: ModuleBase<unknown> = new mod.ctor();
    const pMan = await instance.processManifest(ctx, man);
    const lockEntry = await instance.genLockEntry(ctx, pMan);
    lockObj.moduleEntries[man.id] = lockEntry;
    subCommands[man.id] = instance.command(ctx, pMan);
  }
  await lockFilePath.writeText(
    JSON.stringify(lockObj, undefined, 2),
  );
  return { subCommands, serializedConfig };
}

async function readAndSerializeConfig(configPath: PathRef) {
  let raw;
  switch (configPath.extname()) {
    case "":
      logger().warning("config file has no extension, assuming deno config");
      /* falls through */
    case ".ts":
      raw = await deno.getSerializedConfig(
        configPath.toFileUrl().href,
      );
      break;
    // case ".jsonc":
    case ".json":
      raw = await configPath.readJson();
      break;
    default:
      throw new Error(
        `unrecognized ghjk config type provided at path: ${configPath}`,
      );
  }
  const res = validators.serializedConfig.safeParse(raw);
  if (!res.success) {
    logger().error("zod error", res.error);
    logger().error("serializedConf", raw);
    throw new Error(`error parsing seralized config from ${configPath}`);
  }
  return res.data;
}

const lockObjValidator = zod.object({
  version: zod.string(),
  platform: zod.tuple([portValidators.osEnum, portValidators.archEnum]),
  source: validators.serializedConfig,
  moduleEntries: zod.record(zod.string(), zod.unknown()),
});

async function readLockFile(lockFilePath: PathRef) {
  const raw = await lockFilePath.readJson();
  const res = lockObjValidator.safeParse(raw);
  if (!res.success) {
    logger().error("zod error", res.error);
    throw new Error(`error parsing lockfile from ${lockFilePath}`);
  }
  const lockObj = res.data;
  return lockObj;
}
