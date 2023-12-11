//! Install ghjk for the current user

import "./setup_logger.ts";
import { defaultInstallArgs, detectShell, install } from "./install/mod.ts";

if (import.meta.main) {
  const skipBinInstall = Deno.env.get("GHJK_INSTALL_SKIP_EXE");
  await install({
    ...defaultInstallArgs,
    ghjkDir: Deno.env.get("GHJK_DIR") ?? defaultInstallArgs.ghjkDir,
    skipExecInstall: skipBinInstall == "0" || skipBinInstall == "false",
    shellsToHook: Deno.env.get("GHJK_INSTALL_HOOK_SHELLS")
      ?.split(",")
      ?.map((str) => str.trim())
      ?.filter((str) => str.length > 0) ??
      [
        await detectShell(),
      ],
    ghjkExecInstallDir: Deno.env.get("GHJK_INSTALL_EXE_DIR") ??
      defaultInstallArgs.ghjkExecInstallDir,
    shellHookMarker: Deno.env.get("GHJK_INSTALL_HOOK_MARKER") ??
      defaultInstallArgs.shellHookMarker,
  });
} else {
  throw new Error(
    "unexpected ctx: if you want to access the ghjk installer, import `install` from ./install/mod.ts",
  );
}
