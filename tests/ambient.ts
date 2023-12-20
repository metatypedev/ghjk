import "../setup_logger.ts";
import { std_assert } from "../deps/dev.ts";
import { AmbientAccessPort } from "../modules/ports/ambient.ts";
import validators, {} from "../modules/ports/types.ts";

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
for (const manUnclean of manifests) {
  const manifest = validators.ambientAccessPortManifest.parse(manUnclean);
  Deno.test(`ambient access ${manifest.name}`, async () => {
    const plug = new AmbientAccessPort(manifest);
    const versions = await plug.listAll({
      depArts: {},
      manifest,
      config: {
        portName: manifest.name,
      },
    });
    console.log(versions);
    std_assert.assertEquals(versions.length, 1);
  });
}
