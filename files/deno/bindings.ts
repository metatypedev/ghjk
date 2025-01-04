//! this loads the ghjk.ts module and provides a program for it

//// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

// all imports in here should be dynamic imports as we want to
// modify the Deno namespace before anyone touches it

// NOTE: only import types
import { shimDenoNamespace } from "../../utils/worker.ts";
import { zod } from "../../deps/common.ts";
import { Ghjk } from "../../src/ghjk/js/runtime.js";

const serializeArgs = zod.object({
  uri: zod.string(),
});

async function serialize(args: zod.infer<typeof serializeArgs>) {
  const shimHandle = shimDenoNamespace(Deno.env.toObject());
  const { setup: setupLogger } = await import("../../utils/logger.ts");
  setupLogger();
  const mod = await import(args.uri);
  if (!mod.ghjk) {
    throw new Error(`ghjk.ts does not export a ghjk object: ${args.uri}`);
  }
  if (!mod.ghjk.sophon) {
    throw new Error(
      `no sophon found on exported ghjk object from ghjk.ts: ${args.uri}`,
    );
  }
  const rawConfig = await mod.ghjk.sophon.getConfig(args.uri, mod.secureConfig);
  const config = JSON.parse(JSON.stringify(rawConfig));
  return {
    config,
    accessedEnvKeys: shimHandle.getAccessedEnvKeys(),
    readFilePaths: shimHandle.getReadFiles(),
    listedFilePaths: shimHandle.getListedFiles(),
  };
}

const args = serializeArgs.parse(Ghjk.blackboard.get("args"));
const resp = await serialize(args);
Ghjk.blackboard.set("resp", resp);
