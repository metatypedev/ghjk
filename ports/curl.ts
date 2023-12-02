import {
  addInstallGlobal,
  type AmbientAccessPortManifest,
  registerAmbientPortGlobal,
} from "../port.ts";

export const manifest: AmbientAccessPortManifest = {
  ty: "ambientAccess" as const,
  name: "curl@aa",
  version: "0.1.0",
  execName: "curl",
  versionExtractFlag: "--version",
  versionExtractRegex: "(\\d+\\.\\d+\\.\\d+)",
  versionExtractRegexFlags: "",
};

registerAmbientPortGlobal(manifest);
export default function install() {
  addInstallGlobal({
    portName: manifest.name,
  });
}
