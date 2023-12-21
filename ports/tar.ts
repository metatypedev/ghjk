import {
  type AmbientAccessPortManifest,
  InstallConfigSimple,
  osXarch,
} from "../port.ts";

// FIXME: replace with bsdtar
export const manifest: AmbientAccessPortManifest = {
  ty: "ambientAccess@v1" as const,
  name: "tar_aa",
  version: "0.1.0",
  execName: "tar",
  versionExtractFlag: "--version",
  versionExtractRegex: "(\\d+\\.\\d+)",
  versionExtractRegexFlags: "",
  platforms: osXarch(["linux", "darwin"], ["aarch64", "x86_64"]),
};

export default function conf(config: InstallConfigSimple = {}) {
  return {
    ...config,
    port: manifest,
  };
}
