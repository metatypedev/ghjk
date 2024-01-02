import { std_path, zod } from "../deps/common.ts";
import { cliffy_cmd } from "../deps/cli.ts";
import logger, { isColorfulTty } from "../utils/logger.ts";

import { $, envDirFromConfig, JSONValue, PathRef } from "../utils/mod.ts";
import validators from "./types.ts";
import type { SerializedConfig } from "./types.ts";
import * as std_modules from "../modules/std.ts";
import * as deno from "./deno.ts";
import type { ModuleBase } from "../modules/mod.ts";

export interface CliArgs {
  ghjkDir: string;
  configPath: string;
}

// FIXME: subset of ghjk commands should be functional
// even if config file not found
export async function cli(args: CliArgs) {
  const configPath = std_path.normalize(
    std_path.resolve(Deno.cwd(), args.configPath),
  );
  const ghjkDir = std_path.normalize(
    std_path.resolve(Deno.cwd(), args.ghjkDir),
  );
  const envDir = envDirFromConfig(ghjkDir, configPath);

  logger().debug({ configPath, envDir });

  const ctx = { ghjkDir, configPath, envDir };

  const configFileStat = await $.path(configPath).stat();
  if (!configFileStat) {
    throw new Error("unable to locate config file", {
      cause: { configPath, envDir, ghjkDir },
    });
  }
  const lockFilePath = $.path(configPath).parentOrThrow().join(
    "ghjk.lock",
  );
  const lockFileStat = await lockFilePath.stat();
  let serializedConfig: SerializedConfig;
  const subCommands = {} as Record<string, cliffy_cmd.Command>;
  // if no lockfile found or if it's older than the config file
  if (!lockFileStat || lockFileStat.mtime! < configFileStat.mtime!) {
    const serializedConfig = await serializeConfig(configPath);
    const lockObj: zod.infer<typeof lockObjValidator> = {
      version: "0",
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
  } else {
    const lockObj = await readLockFile(lockFilePath);
    serializedConfig = lockObj.source;
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
  }

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

async function serializeConfig(configPath: string) {
  let raw;
  switch (std_path.extname(configPath)) {
    case "":
      logger().warning("config file has no extension, assuming deno config");
      /* falls through */
    case ".ts":
      raw = await deno.getSerializedConfig(
        std_path.toFileUrl(configPath).href,
      );
      break;
    // case ".jsonc":
    case ".json":
      raw = JSON.parse(await Deno.readTextFile(configPath));
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
  version: zod.literal("0"),
  source: validators.serializedConfig,
  moduleEntries: zod.record(zod.string(), zod.unknown()),
});

async function readLockFile(lockFilePath: PathRef) {
  logger().debug("reading lockfile", lockFilePath);
  const raw = await lockFilePath.readJson();
  const res = lockObjValidator.safeParse(raw);
  if (!res.success) {
    logger().error("zod error", res.error);
    throw new Error(`error parsing lockfile from ${lockFilePath}`);
  }
  const lockObj = res.data;
  return lockObj;
}
