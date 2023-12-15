import {
  type AmbientAccessPortManifest,
  InstallConfigSimple,
  osXarch,
} from "../port.ts";

export const manifest: AmbientAccessPortManifest = {
  ty: "ambientAccess@v1" as const,
  name: "unzip_aa",
  version: "0.1.0",
  execName: "unzip",
  versionExtractFlag: "-v",
  versionExtractRegex: "(\\d+\\.\\d+)",
  versionExtractRegexFlags: "",
  platforms: osXarch(["linux", "darwin", "windows"], ["aarch64", "x86_64"]),
};

export default function conf(config: InstallConfigSimple = {}) {
  return {
    ...config,
    port: manifest,
  };
}
