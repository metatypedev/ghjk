import "./setup_globals.ts";
import { std_assert } from "../deps/dev.ts";
import { AmbientAccessPlug } from "../core/ambient.ts";
import { type AmbientAccessPlugManifest } from "../core/types.ts";

import * as tar from "../plugs/tar.ts";
import * as git from "../plugs/git.ts";
import * as curl from "../plugs/curl.ts";
import * as unzip from "../plugs/unzip.ts";

const manifests = [
  {
    name: "ls",
    execName: "ls",
    version: "0.1.0",
    versionExtractFlag: "--version",
    versionExtractRegex: "(\\d+\\.\\d+)",
    versionExtractRegexFlags: "",
  },
  tar.manifest,
  git.manifest,
  curl.manifest,
  unzip.manifest,
];
for (const manifest of manifests) {
  Deno.test(`ambient access ${manifest.name}`, async () => {
    const plug = new AmbientAccessPlug(manifest as AmbientAccessPlugManifest);
    const versions = await plug.listAll({ depShims: {} });
    console.log(versions);
    std_assert.assertEquals(versions.length, 1);
  });
}
