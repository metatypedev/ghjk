import { AsdfInstallConf, manifest as asdfManifest } from "./asdf.ts";
import { manifest as pipiManifest, PipiInstallConf } from "./pipi.ts";

export default function conf(
  config: PipiInstallConf & AsdfInstallConf,
) {
  if (Deno.build.os === "darwin") {
    return {
      port: asdfManifest,
      ...config,
    };
  }
  return {
    port: pipiManifest,
    ...config,
  };
}
