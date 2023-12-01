import "../setup_logger.ts";

import { std_path } from "../deps/common.ts";
import logger from "../core/logger.ts";
import { $ } from "../core/utils.ts";

import validators, { type SerializedConfig } from "./types.ts";
import * as std_modules from "../modules/std.ts";

async function getSerializedConfigDeno(configPath: string) {
  const denoRunner = import.meta.resolve("./deno.ts");
  return await $`deno run --allow-read=. --allow-env --allow-net ${denoRunner} ${configPath}`
    .json();
}

export async function main() {
  const configPath = Deno.args[0];

  let serializedJson;
  switch (std_path.extname(configPath)) {
    case "":
      logger().warning("config file has no extension, assuming deno config");
      /* falls through */
    case ".ts":
      serializedJson = await getSerializedConfigDeno(configPath);
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
