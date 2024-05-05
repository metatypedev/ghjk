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
    logger().warn(
      "ghjk could not find any ghjkfiles, try creating a `ghjk.ts` script.",
    );
    // Deno.exit(2);
  }
  await cli({
    ghjkShareDir: Deno.env.get("GHJK_SHARE_DIR") ??
      dirs().shareDir.resolve("ghjk").toString(),
    ghjkfilePath: ghjkfile ? std_path.resolve(Deno.cwd(), ghjkfile) : undefined,
  });
} else {
  throw new Error(
    `unexpected context: this module is an entrypoint. If you want to programmatically invoke the ghjk cli, import \`cli\` from ${
      import.meta.resolve("./host/mod.ts")
    }`,
  );
}
