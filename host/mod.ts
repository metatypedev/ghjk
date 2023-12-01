import "../setup_logger.ts";

import { std_path } from "../deps/common.ts";
import logger from "../utils/logger.ts";
import { $ } from "../utils/mod.ts";

import validators, { type SerializedConfig } from "./types.ts";
import * as std_modules from "../modules/std.ts";
import * as deno from "./deno.ts";

export async function main() {
  const configPath = Deno.args[0];

  logger().debug("config", configPath);

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

  console.log(serializedJson);
  //   const serializedConfig = validators.serializedConfig.parse(
  //     serializedJson,
  //   );
}
