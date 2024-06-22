//! this loads the ghjk.ts module and provides a program for it

//// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

// all imports in here should be dynamic imports as we want to
// modify the Deno namespace before anyone touches it

// NOTE: only import types
import { shimDenoNamespace } from "../../utils/worker.ts";
import type { DriverRequests, DriverResponse } from "./mod.ts";

self.onmessage = onMsg;

async function onMsg(msg: MessageEvent<DriverRequests>) {
  const req = msg.data;
  if (!req.ty) {
    throw new Error(`unrecognized event data`, {
      cause: req,
    });
  }
  let res: DriverResponse;
  if (req.ty == "serialize") {
    res = {
      ty: req.ty,
      payload: await serializeConfig(req.uri, req.envVars),
    };
  } else {
    throw new Error(`unrecognized request type: ${req.ty}`, {
      cause: req,
    });
  }
  self.postMessage(res);
}

async function serializeConfig(uri: string, envVars: Record<string, string>) {
  const shimHandle = shimDenoNamespace(envVars);
  const { setup: setupLogger } = await import("../../utils/logger.ts");
  setupLogger();
  const mod = await import(uri);
  const rawConfig = await mod.sophon.getConfig(uri, mod.secureConfig);
  const config = JSON.parse(JSON.stringify(rawConfig));
  return {
    config,
    accessedEnvKeys: shimHandle.getAccessedEnvKeys(),
    readFiles: shimHandle.getReadFiles(),
    listedFiles: shimHandle.getListedFiles(),
  };
}
