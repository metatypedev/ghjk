import {
  addInstallGlobal,
  type AmbientAccessPlugManifest,
  registerAmbientPlugGlobal,
} from "../plug.ts";

export const manifest: AmbientAccessPlugManifest = {
  name: "awk@aa",
  version: "0.1.0",
  execName: "awk",
  versionExtractFlag: "--version",
  versionExtractRegex: "(\\d+\\.\\d+\\.\\d+)",
  versionExtractRegexFlags: "",
};

registerAmbientPlugGlobal(manifest);
export default function install() {
  addInstallGlobal({
    plugName: manifest.name,
  });
}
