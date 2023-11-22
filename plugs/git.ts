import {
  addInstallGlobal,
  type AmbientAccessPlugManifest,
  registerAmbientPlugGlobal,
} from "../plug.ts";

export const manifest: AmbientAccessPlugManifest = {
  name: "git_aa",
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
