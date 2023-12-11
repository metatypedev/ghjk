import "../setup_logger.ts";
import { std_assert } from "../deps/dev.ts";
import { AmbientAccessPort } from "../modules/ports/ambient.ts";
import { type AmbientAccessPortManifest } from "../modules/ports/types.ts";

import * as tar from "../ports/tar.ts";
import * as git from "../ports/git.ts";
import * as curl from "../ports/curl.ts";
import * as unzip from "../ports/unzip.ts";

const manifests = [
  tar.manifest,
  git.manifest,
  curl.manifest,
  unzip.manifest,
];
for (const manifest of manifests) {
  Deno.test(`ambient access ${manifest.name}`, async () => {
    const plug = new AmbientAccessPort(manifest as AmbientAccessPortManifest);
    const versions = await plug.listAll({ depShims: {} });
    console.log(versions);
    std_assert.assertEquals(versions.length, 1);
  });
}
