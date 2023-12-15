#! /usr/bin/env -S deno run --unstable-worker-options -A  

import "./setup_logger.ts";
import { cli } from "./host/mod.ts";
import { std_path } from "./deps/common.ts";
import logger from "./utils/logger.ts";
import { dirs, findConfig } from "./utils/mod.ts";

if (import.meta.main) {
  const configPath = Deno.env.get("GHJK_CONFIG") ??
    await findConfig(Deno.cwd());
  if (!configPath) {
    logger().error("ghjk did not find any `ghjk.ts` config.");
    Deno.exit(2);
  }
  await cli({
    ghjkDir: Deno.env.get("GHJK_DIR") ??
      std_path.resolve(dirs().shareDir, "ghjk"),
    configPath: std_path.resolve(Deno.cwd(), configPath),
  });
} else {
  throw new Error(
    "unexpected ctx: if you want to run the ghjk cli, import `main` from ./host/mod.ts",
  );
}
