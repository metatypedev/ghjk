import {
  addInstallGlobal,
  type AmbientAccessPortManifest,
  registerAmbientPlugGlobal,
} from "../port.ts";

export const manifest: AmbientAccessPortManifest = {
  name: "curl@aa",
  version: "0.1.0",
  execName: "curl",
  versionExtractFlag: "--version",
  versionExtractRegex: "(\\d+\\.\\d+\\.\\d+)",
  versionExtractRegexFlags: "",
};

registerAmbientPlugGlobal(manifest);
export default function install() {
  addInstallGlobal({
    portName: manifest.name,
  });
}
