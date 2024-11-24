//! this loads the ghjk.ts module and provides a program for it

//// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

// all imports in here should be dynamic imports as we want to
// modify the Deno namespace before anyone touches it

// NOTE: only import types
import { shimDenoNamespace } from "../../utils/worker.ts";

const shimHandle = shimDenoNamespace(Deno.env.toObject());
const { setup: setupLogger } = await import("../../utils/logger.ts");
setupLogger();
const uri = import.meta.resolve("../../ghjk.ts");
const mod = await import(uri);
const rawConfig = await mod.sophon.getConfig(uri, mod.secureConfig);
const config = JSON.parse(JSON.stringify(rawConfig));
console.log({
  config,
  accessedEnvKeys: shimHandle.getAccessedEnvKeys(),
  readFiles: shimHandle.getReadFiles(),
  listedFiles: shimHandle.getListedFiles(),
});
