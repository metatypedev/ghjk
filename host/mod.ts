import "../setup_logger.ts";

import { std_path } from "../deps/common.ts";
import { cliffy_cmd } from "../deps/cli.ts";
import logger from "../utils/logger.ts";
// import { $ } from "../utils/mod.ts";

import { envDirFromConfig, findConfig, isColorfulTty } from "../utils/mod.ts";
import validators from "./types.ts";
import * as std_modules from "../modules/std.ts";
import * as deno from "./deno.ts";

export async function main() {
  const configPath = Deno.env.get("GHJK_CONFIG") ??
    await findConfig(Deno.cwd());
  if (!configPath) {
    logger().error("ghjk did not find any `ghjk.ts` config.");
    Deno.exit(2);
  }
  const envDir = envDirFromConfig(configPath);

  logger().debug({ configPath });
  logger().debug({ envDir });

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
  const serializedConfig = validators.serializedConfig.parse(serializedJson);

  const ctx = { configPath, envDir };
  let cmd: cliffy_cmd.Command<any, any, any, any> = new cliffy_cmd.Command()
    .name("ghjk")
    .version("0.1.0") // FIXME: better way to resolve version
    .description("Programmable runtime manager.")
    .action(function () {
      this.showHelp();
    })
    .command(
      "config",
      new cliffy_cmd.Command()
        .description("Print the extracted config from the ghjk.ts file")
        .action(function () {
          console.log(Deno.inspect(serializedConfig, {
            depth: 10,
            colors: isColorfulTty(),
          }));
        }),
    );
  for (const man of serializedConfig.modules) {
    const mod = std_modules.map[man.id];
    if (!mod) {
      throw new Error(`unrecognized module specified by ghjk.ts: ${man.id}`);
    }
    const instance = mod.ctor(ctx, man);
    cmd = cmd.command(man.id, instance.command());
  }
  cmd
    .command("completions", new cliffy_cmd.CompletionsCommand())
    .parse(Deno.args);
  //   const serializedConfig = validators.serializedConfig.parse(
  //     serializedJson,
  //   );
}
