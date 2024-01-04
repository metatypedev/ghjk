import { cliffy_cmd, equal, zod } from "../deps/cli.ts";
import logger, { isColorfulTty } from "../utils/logger.ts";

import {
  $,
  bufferHashHex,
  envDirFromConfig,
  Json,
  PathRef,
} from "../utils/mod.ts";
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

  const ctx = { ghjkDir, configPath, envDir, state: new Map() };

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

  const ghjkfileHash = await bufferHashHex(
    await configPath.readBytes(),
  );

  const subCommands = {} as Record<string, cliffy_cmd.Command>;

  const foundLockObj = await readLockFile(lockFilePath);
  const lockEntries = {} as Record<string, unknown>;
  // TODO: figure out cross platform lockfiles :O
  let serializedConfig;
  if (
    foundLockObj && // lockfile found
    foundLockObj.version == "0"
  ) {
    logger().debug("loading lockfile", lockFilePath);
    for (const man of foundLockObj.config.modules) {
      const mod = std_modules.map[man.id];
      if (!mod) {
        throw new Error(
          `unrecognized module specified by lockfile config: ${man.id}`,
        );
      }
      const entry = foundLockObj.moduleEntries[man.id];
      if (!entry) {
        throw new Error(
          `no lock entry found for module specified by lockfile config: ${man.id}`,
        );
      }
      const instance: ModuleBase<unknown, unknown> = new mod.ctor();
      lockEntries[man.id] = await instance.loadLockEntry(
        ctx,
        entry as Json,
      );
    }

    // avoid reserlizing the config if
    // the ghjkfile and environment is _satisfcatorily_
    // similar
    if (
      foundLockObj.ghjkfileHash == ghjkfileHash &&
      foundLockObj.platform[0] == Deno.build.os &&
      foundLockObj.platform[1] == Deno.build.arch
    ) {
      serializedConfig = foundLockObj.config;
    }
  }

  if (!serializedConfig) {
    logger().info("serializing ghjkfile", configPath);
    serializedConfig = await readAndSerializeConfig(configPath);
  }

  const newLockObj: zod.infer<typeof lockObjValidator> = {
    version: "0",
    platform: [Deno.build.os, Deno.build.arch],
    ghjkfileHash,
    config: serializedConfig,
    moduleEntries: {} as Record<string, unknown>,
  };
  const instances = [];
  for (const man of serializedConfig.modules) {
    const mod = std_modules.map[man.id];
    if (!mod) {
      throw new Error(`unrecognized module specified by ghjk.ts: ${man.id}`);
    }
    const instance: ModuleBase<unknown, unknown> = new mod.ctor();
    const pMan = await instance.processManifest(ctx, man, lockEntries[man.id]);
    instances.push([man.id, instance, pMan] as const);
    subCommands[man.id] = instance.command(ctx, pMan);
  }
  // generate the lock entries after *all* the modules
  // are done processing their config to allow
  // any shared stores to be properly populated
  // e.g. the resolution memo store
  newLockObj.moduleEntries = Object.fromEntries(
    await Array.fromAsync(
      instances.map(
        async (
          [id, instance, pMan],
        ) => [id, await instance.genLockEntry(ctx, pMan)],
      ),
    ),
  );
  // avoid writing lockfile if nothing's changed
  if (!foundLockObj || !equal.equal(newLockObj, foundLockObj)) {
    await lockFilePath.writeText(
      JSON.stringify(newLockObj, undefined, 2),
    );
  }
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
  ghjkfileHash: zod.string(),
  config: validators.serializedConfig,
  moduleEntries: zod.record(zod.string(), zod.unknown()),
});

async function readLockFile(lockFilePath: PathRef) {
  const raw = await lockFilePath.readMaybeJson();
  if (!raw) return;
  const res = lockObjValidator.safeParse(raw);
  if (!res.success) {
    logger().error("zod error", res.error);
    throw new Error(`error parsing lockfile from ${lockFilePath}`);
  }
  const lockObj = res.data;
  return lockObj;
}
