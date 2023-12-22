import { std_path } from "../deps/common.ts";
import { cliffy_cmd } from "../deps/cli.ts";
import logger, { isColorfulTty } from "../utils/logger.ts";
// import { $ } from "../utils/mod.ts";

import { envDirFromConfig } from "../utils/mod.ts";
import validators from "./types.ts";
import * as std_modules from "../modules/std.ts";
import * as deno from "./deno.ts";

export interface CliArgs {
  ghjkDir: string;
  configPath: string;
}
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

  const serializedConfig = await serializeConfig(configPath);

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
    );
  for (const man of serializedConfig.modules) {
    const mod = std_modules.map[man.id];
    if (!mod) {
      throw new Error(`unrecognized module specified by ghjk.ts: ${man.id}`);
    }
    const instance = mod.ctor(ctx, man);
    cmd = cmd.command(man.id, instance.command());
  }
  await cmd
    .command("completions", new cliffy_cmd.CompletionsCommand())
    .parse(Deno.args);
}

async function serializeConfig(configPath: string) {
  let serializedJson;
  switch (std_path.extname(configPath)) {
    case "":
      logger().warning("config file has no extension, assuming deno config");
      /* falls through */
    case ".ts":
      serializedJson = await deno.getSerializedConfig(
        std_path.toFileUrl(configPath).href,
      );
      break;
    // case ".jsonc":
    case ".json":
      serializedJson = JSON.parse(await Deno.readTextFile(configPath));
      break;
    default:
      throw new Error(
        `unrecognized ghjk config type provided at path: ${configPath}`,
      );
  }
  const res = validators.serializedConfig.safeParse(serializedJson);
  if (!res.success) {
    logger().error("zod error", res.error);
    logger().error("serializedConf", serializedJson);
    throw new Error(`error parsing seralized config from ${configPath}`);
  }
  return res.data;
}
