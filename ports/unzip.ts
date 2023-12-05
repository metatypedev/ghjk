import {
  addInstallGlobal,
  type AmbientAccessPortManifest,
  registerAmbientPortGlobal,
} from "../port.ts";

export const manifest: AmbientAccessPortManifest = {
  ty: "ambientAccess" as const,
  name: "unzip@aa",
  version: "0.1.0",
  execName: "unzip",
  versionExtractFlag: "-v",
  versionExtractRegex: "(\\d+\\.\\d+)",
  versionExtractRegexFlags: "",
};

registerAmbientPortGlobal(manifest);
export default function install() {
  addInstallGlobal({
    portName: manifest.name,
  });
}
