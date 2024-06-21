import { InstallConfigFat, InstallConfigSimple } from "../port.ts";
import { AsdfInstallConf } from "./asdf.ts";
import { PipiInstallConf } from "./pipi.ts";
import * as ports from "./mod.ts";

export default function conf(
  config: InstallConfigSimple,
): InstallConfigFat[] {
  const version = config.version;
  if (Deno.build.os === "darwin") {
    const pipiConfig: PipiInstallConf = {
      packageName: "cmake",
      version: version,
    };
    return ports.pipi(pipiConfig);
  }
  const asdfConfig: AsdfInstallConf = {
    pluginRepo: "https://github.com/asdf-community/asdf-cmake",
    installType: "version",
    version: version,
  };

  return [ports.asdf(asdfConfig)];
}
