#!/usr/bin/env -S deno run --unstable-worker-options -A  

import "./setup_logger.ts";
import { cli } from "./host/mod.ts";
import { std_path } from "./deps/common.ts";
import logger from "./utils/logger.ts";
import { dirs, findEntryRecursive } from "./utils/mod.ts";

if (import.meta.main) {
  // look for ghjkdir
  let ghjkdir = Deno.env.get("GHJK_DIR") ??
    await findEntryRecursive(Deno.cwd(), ".ghjk");
  const ghjkfile = ghjkdir
    ? await findEntryRecursive(std_path.dirname(ghjkdir), "ghjk.ts")
    : await findEntryRecursive(Deno.cwd(), "ghjk.ts");
  if (!ghjkdir && !ghjkfile) {
    logger().warn(
      "ghjk could not find any ghjkfiles or ghjkdirs, try creating a `ghjk.ts` script.",
    );
    // Deno.exit(2);
  }
  if (ghjkfile && !ghjkdir) {
    ghjkdir = std_path.resolve(std_path.dirname(ghjkfile), ".ghjk");
  }
  await cli({
    // FIXME: better
    reFlagSet: !!Deno.env.get("GHJK_RE") &&
      !(["false", "", ""].includes(Deno.env.get("GHJK_RE")!)),
    lockedFlagSet: !!Deno.env.get("GHJK_LOCKED") &&
      !(["false", "", ""].includes(Deno.env.get("GHJK_LOCKED")!)),

    ghjkShareDir: Deno.env.get("GHJK_SHARE_DIR") ??
      dirs().shareDir.resolve("ghjk").toString(),
    ghjkfilePath: ghjkfile ? std_path.resolve(Deno.cwd(), ghjkfile) : undefined,
    ghjkDirPath: ghjkdir ? std_path.resolve(Deno.cwd(), ghjkdir) : undefined,
  });
} else {
  throw new Error(
    `unexpected context: this module is an entrypoint. If you want to programmatically invoke the ghjk cli, import \`cli\` from ${
      import.meta.resolve("./host/mod.ts")
    }`,
  );
}
