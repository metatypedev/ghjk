import { asdf, AsdfInstallConfigLite } from "../port.ts";

export default function conf(
  config: Omit<AsdfInstallConfigLite, "portId">,
) {
  return {
    ...config,
    port: asdf.manifest,
  };
}
