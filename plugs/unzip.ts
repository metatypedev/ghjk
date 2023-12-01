import {
  addInstallGlobal,
  type AmbientAccessPlugManifest,
  registerAmbientPlugGlobal,
} from "../port.ts";

export const manifest: AmbientAccessPlugManifest = {
  name: "unzip@aa",
  version: "0.1.0",
  execName: "unzip",
  versionExtractFlag: "-v",
  versionExtractRegex: "(\\d+\\.\\d+)",
  versionExtractRegexFlags: "",
};

registerAmbientPlugGlobal(manifest);
export default function install() {
  addInstallGlobal({
    plugName: manifest.name,
  });
}
