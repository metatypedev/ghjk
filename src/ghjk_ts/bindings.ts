//! this loads the user's ghjk.ts and serializes the conig

//// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

// all imports in here (except the following two) should be
// dynamic imports as we want to modify the Deno namespace
// before anyone touches it

// NOTE: only import types
import { shimDenoNamespace } from "../deno_utils/worker.ts";
import { Ghjk } from "../ghjk/js/runtime.js";

// TODO: shim Deno.exit to avoid killing whole program

const shimHandle = shimDenoNamespace(Deno.env.toObject());

const { zod } = await import("../deps.ts");

const serializeArgs = zod.object({
  uri: zod.string(),
});

const args = serializeArgs.parse(Ghjk.blackboard.get("args"));
const resp = await serialize(args);
Ghjk.blackboard.set("resp", resp);

async function serialize(args: typeof serializeArgs._output) {
  const { setup: setupLogger } = await import("../deno_utils/logger.ts");
  setupLogger();
  const mod = await import(args.uri);
  if (!mod.sophon) {
    throw new Error(
      `no sophon found on exported ghjk object from ghjk.ts: ${args.uri}`,
    );
  }
  const rawConfig = await mod.sophon.getConfig(args.uri, mod.secureConfig);
  const config = JSON.parse(JSON.stringify(rawConfig));
  return {
    config,
    accessedEnvKeys: shimHandle.getAccessedEnvKeys(),
    readFilePaths: shimHandle.getReadFiles(),
    listedFilePaths: shimHandle.getListedFiles(),
  };
}
