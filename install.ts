#!/usr/bin/env -S deno run --unstable-worker-options -A  

//! Install ghjk for the current user

import "./src/deno_utils/setup_logger.ts";
import { defaultInstallArgs, install } from "./src/install/mod.ts";

// import the main entry points so that they get cached into the deno
// store during install
import "./src/sys_deno/std.ts";
import "./src/ghjk_ts/mod.ts";
import "./src/deno_ports/mod.ts";
import "./ports/mod.ts";

if (import.meta.main) {
  const shellsToHook = Deno.env.get("GHJK_INSTALL_HOOK_SHELLS")
    ?.split(",")
    ?.map((str) => str.trim())
    ?.filter((str) => str.length > 0);
  // if (!shellsToHook) {
  //   const userShell = await detectShell();
  //   if (!userShell) {
  //     throw new Error(
  //       "Unable to detect user's shell. Set $GHJK_INSTALL_HOOK_SHELLS to an empty string if no shell hooks are desired.",
  //     );
  //   }
  //   shellsToHook = [userShell];
  // }
  await install({
    ...defaultInstallArgs,
    ghjkDataDir: Deno.env.get("GHJK_DATA_DIR") ??
      defaultInstallArgs.ghjkDataDir,
    shellsToHook,
    shellHookMarker: Deno.env.get("GHJK_INSTALL_HOOK_MARKER") ??
      defaultInstallArgs.shellHookMarker,
  });
} else {
  throw new Error(
    `unexpected context: this module is an entrypoint. If you want to programmatically invoke the ghjk installer, import \`install\` from ${
      import.meta.resolve("./install/mod.ts")
    }`,
  );
}
