#!/usr/bin/env -S deno run --unstable-worker-options -A  

//! Install ghjk for the current user

import "./setup_logger.ts";
import { defaultInstallArgs, install } from "./install/mod.ts";
import { detectShell } from "./utils/mod.ts";

if (import.meta.main) {
  const skipBinInstall = Deno.env.get("GHJK_INSTALL_SKIP_EXE");
  const noLockfile = Deno.env.get("GHJK_INSTALL_NO_LOCKFILE");

  let shellsToHook = Deno.env.get("GHJK_INSTALL_HOOK_SHELLS")
    ?.split(",")
    ?.map((str) => str.trim())
    ?.filter((str) => str.length > 0);
  if (!shellsToHook) {
    const userShell = await detectShell();
    if (!userShell) {
      throw new Error(
        "Unable to detect user's shell. Set $GHJK_INSTALL_HOOK_SHELLS to an empty string if no shell hooks are desired.",
      );
    }
    shellsToHook = [userShell];
  }
  await install({
    ...defaultInstallArgs,
    ghjkShareDir: Deno.env.get("GHJK_SHARE_DIR") ??
      defaultInstallArgs.ghjkShareDir,
    skipExecInstall: !!skipBinInstall && skipBinInstall != "0" &&
      skipBinInstall != "false",
    shellsToHook,
    ghjkExecInstallDir: Deno.env.get("GHJK_INSTALL_EXE_DIR") ??
      defaultInstallArgs.ghjkExecInstallDir,
    ghjkExecDenoExec: Deno.env.get("GHJK_INSTALL_DENO_EXEC") ??
      defaultInstallArgs.ghjkExecDenoExec,
    shellHookMarker: Deno.env.get("GHJK_INSTALL_HOOK_MARKER") ??
      defaultInstallArgs.shellHookMarker,
    noLockfile: !!noLockfile && noLockfile != "0" && noLockfile != "false",
    ghjkDenoCacheDir: Deno.env.get("GHJK_INSTALL_DENO_DIR") ??
      defaultInstallArgs.ghjkDenoCacheDir,
  });
} else {
  throw new Error(
    `unexpected context: this module is an entrypoint. If you want to programmatically invoke the ghjk installer, import \`install\` from ${
      import.meta.resolve("./install/mod.ts")
    }`,
  );
}
