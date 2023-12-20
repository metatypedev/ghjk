import {
  ALL_ARCH,
  ALL_OS,
  type AmbientAccessPortManifest,
  InstallConfigSimple,
  osXarch,
} from "../port.ts";

export const manifest: AmbientAccessPortManifest = {
  ty: "ambientAccess@v1" as const,
  name: "git_aa",
  version: "0.1.0",
  execName: "git",
  versionExtractFlag: "--version",
  versionExtractRegex: "(\\d+\\.\\d+\\.\\d+)",
  versionExtractRegexFlags: "",
  platforms: osXarch([...ALL_OS], [...ALL_ARCH]),
};

export default function conf(config: InstallConfigSimple = {}) {
  return {
    ...config,
    port: manifest,
  };
}
