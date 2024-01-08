#!/usr/bin/env -S deno run --unstable-worker-options -A  

import "./setup_logger.ts";
import { cli } from "./host/mod.ts";
import { std_path } from "./deps/common.ts";
import logger from "./utils/logger.ts";
import { dirs, findConfig } from "./utils/mod.ts";

if (import.meta.main) {
  const ghjkfile = Deno.env.get("GHJKFILE") ??
    await findConfig(Deno.cwd());
  if (!ghjkfile) {
    logger().error(
      "ghjk could not find any ghjkfiles, try creating a `ghjk.ts` script.",
    );
    Deno.exit(2);
  }
  await cli({
    ghjkShareDir: Deno.env.get("GHJK_SHARE_DIR") ??
      std_path.resolve(dirs().shareDir, "ghjk"),
    ghjkfilePath: std_path.resolve(Deno.cwd(), ghjkfile),
  });
} else {
  throw new Error(
    "unexpected ctx: if you want to run the ghjk cli, import `main` from ./host/mod.ts",
  );
}
