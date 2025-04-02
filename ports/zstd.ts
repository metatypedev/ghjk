import {
  type AmbientAccessPortManifest,
  InstallConfigSimple,
  osXarch,
} from "../src/deno_ports/mod.ts";

export const manifest: AmbientAccessPortManifest = {
  ty: "ambientAccess@v1" as const,
  name: "zstd_aa",
  version: "0.1.0",
  execName: "zstd",
  versionExtractFlag: "--version",
  versionExtractRegex: "v(\\d+\\.\\d+\\.\\d+)",
  versionExtractRegexFlags: "",
  platforms: osXarch(["linux", "darwin"], ["aarch64", "x86_64"]),
};

export default function conf(config: InstallConfigSimple = {}) {
  return {
    ...config,
    port: manifest,
  };
}
