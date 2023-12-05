import {
  addInstallGlobal,
  type AmbientAccessPortManifest,
  registerAmbientPortGlobal,
} from "../port.ts";

export const manifest: AmbientAccessPortManifest = {
  ty: "ambientAccess" as const,
  name: "git@aa",
  version: "0.1.0",
  execName: "git",
  versionExtractFlag: "--version",
  versionExtractRegex: "(\\d+\\.\\d+\\.\\d+)",
  versionExtractRegexFlags: "",
};

registerAmbientPortGlobal(manifest);
export default function git() {
  addInstallGlobal({
    portName: manifest.name,
  });
}
