import {
  addInstallGlobal,
  type AmbientAccessPortManifest,
  registerAmbientPlugGlobal,
} from "../port.ts";

export const manifest: AmbientAccessPortManifest = {
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
    portName: manifest.name,
  });
}
