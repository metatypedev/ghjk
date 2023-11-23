import {
  addInstallGlobal,
  type AmbientAccessPlugManifest,
  registerAmbientPlugGlobal,
} from "../plug.ts";

export const manifest: AmbientAccessPlugManifest = {
  name: "tar@aa",
  version: "0.1.0",
  execName: "tar",
  versionExtractFlag: "--version",
  versionExtractRegex: "(\\d+\\.\\d+)",
  versionExtractRegexFlags: "",
};

registerAmbientPlugGlobal(manifest);
export default function install() {
  addInstallGlobal({
    plugName: manifest.name,
  });
}
