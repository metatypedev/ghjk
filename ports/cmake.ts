import { InstallConfigFat, InstallConfigSimple } from "../port.ts";
import { AsdfInstallConf } from "./asdf.ts";
import { PipiInstallConf } from "./pipi.ts";
import * as ports from "./mod.ts";

/**
 * Port to install cmake
 *
 * For macOS users, you need to add python as allowed build dependencies
 * as cmake is downladed via pip install.
 *
 * Example:
 * ```typescript
 * const installs = {
    python_latest: ports.cpy_bs({ version: "3.12.2", releaseTag: "20240224" }),
};
 * config({
    stdDeps: true,
    allowedBuildDeps: [
        installs.python_latest
    ],
    enableRuntimes: true
});
 * ```
 *
 */
export default function conf(
  config: InstallConfigSimple = {},
): InstallConfigFat[] {
  /*
    The universal macOS cmake build downloaded by asdf crashes
  due to security restrictions in macOS, so it's installed using pipi port instead, which runs with no problems.
   */
  if (Deno.build.os === "darwin") {
    const pipiConfig: PipiInstallConf = {
      packageName: "cmake",
      version: config.version,
    };
    return ports.pipi(pipiConfig);
  }
  const asdfConfig: AsdfInstallConf = {
    ...config,
    pluginRepo: "https://github.com/asdf-community/asdf-cmake",
    installType: "version",
    version: config.version,
  };

  return [ports.asdf(asdfConfig)];
}
