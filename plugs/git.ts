import {
  addInstallGlobal,
  type AmbientAccessPlugManifest,
  registerAmbientPlugGlobal,
} from "../port.ts";

export const manifest: AmbientAccessPlugManifest = {
  name: "git@aa",
  version: "0.1.0",
  execName: "git",
  versionExtractFlag: "--version",
  versionExtractRegex: "(\\d+\\.\\d+\\.\\d+)",
  versionExtractRegexFlags: "",
};

registerAmbientPlugGlobal(manifest);
export default function git() {
  addInstallGlobal({
    plugName: manifest.name,
  });
}
