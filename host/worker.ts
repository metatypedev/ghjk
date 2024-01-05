//! this loads the ghjk.ts module and provides a program for it

//// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

// all imports in here should be dynamic imports as we want to
// modify the Deno namespace before anyone touches it

// NOTE: only import types
import type { DriverRequests, DriverResponse } from "./deno.ts";

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
  const { setup: setupLogger } = await import(
    "../utils/logger.ts"
  );
  setupLogger();
  const mod = await import(uri);
  const rawConfig = await mod.ghjk.getConfig(mod.secureConfig);
  const config = JSON.parse(JSON.stringify(rawConfig));
  return {
    config,
    accessedEnvKeys: shimHandle.getAccessedEnvKeys(),
  };
}

function shimDenoNamespace(envVars: Record<string, string>) {
  const { envShim, getAccessedEnvKeys } = DenoEnvShim(envVars);
  Object.defineProperty(Deno, "env", {
    value: envShim,
  });
  return { getAccessedEnvKeys };
}

function DenoEnvShim(vars: Record<string, string>) {
  const map = new Map<string, string>([...Object.entries(vars)]);
  const accessedEnvKeys = new Set<string>();
  const envShim: Deno.Env = {
    get(key: string) {
      accessedEnvKeys.add(key);
      return map.get(key);
    },
    set(key: string, val: string) {
      accessedEnvKeys.add(key);
      map.set(key, val);
    },
    has(key: string) {
      accessedEnvKeys.add(key);
      return map.has(key);
    },
    delete(key: string) {
      accessedEnvKeys.add(key);
      map.delete(key);
    },
    toObject() {
      for (const key of map.keys()) {
        accessedEnvKeys.add(key);
      }
      return Object.fromEntries([...map.entries()]);
    },
  };
  return {
    envShim,
    getAccessedEnvKeys() {
      return [...accessedEnvKeys.keys()];
    },
  };
}
