import "../setup_logger.ts";

import { std_path } from "../deps/common.ts";
import logger from "../core/logger.ts";

function runDenoConfig(configPath: string) {
}

const configPath = Deno.args[0];

switch (std_path.extname(configPath)) {
  case "":
    logger().warning("config file has no extension, assuming deno config");
    /* falls through */
  case ".ts":
    runDenoConfig(configPath);
    break;
  default:
    throw new Error(
      `unrecognized ghjk config type provided at path: ${configPath}`,
    );
}
