//! this loads the ghjk.ts module and provides a program for it

//// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import { std_url } from "../deps/common.ts";

import { inWorker } from "../utils/mod.ts";
import logger, { setup as setupLogger } from "../utils/logger.ts";

if (inWorker()) {
  initWorker();
}

function initWorker() {
  setupLogger();

  self.onmessage = onMsg;
}

export type DriverRequests = {
  ty: "serialize";
  uri: string;
};
export type DriverResponse = {
  ty: "serialize";
  payload: unknown;
};
async function onMsg(msg: MessageEvent<DriverRequests>) {
  const req = msg.data;
  if (!req.ty) {
    logger().error(`invalid msg data`, req);
    throw new Error(`unrecognized event data`);
  }
  let res: DriverResponse;
  if (req.ty == "serialize") {
    res = {
      ty: req.ty,
      payload: await serializeConfig(req.uri),
    };
  } else {
    logger().error(`invalid DriverRequest type`, req);
    throw new Error(`unrecognized request type: ${req.ty}`);
  }
  self.postMessage(res);
}

async function serializeConfig(uri: string) {
  const mod = await import(uri);
  const config = mod.ghjk.getConfig(mod.secureConfig);
  return JSON.parse(JSON.stringify(config));
}

export async function getSerializedConfig(configUri: string) {
  const resp = await rpc(configUri, {
    ty: "serialize",
    uri: configUri,
  });
  if (resp.ty != "serialize") {
    throw new Error(`invalid response type: ${resp.ty}`);
  }
  return resp.payload;
}

async function rpc(moduleUri: string, req: DriverRequests) {
  const baseName = std_url.basename(moduleUri);
  const dirBaseName = std_url.basename(std_url.dirname(moduleUri));
  const worker = new Worker(import.meta.url, {
    name: `${dirBaseName}/${baseName}`,
    type: "module",
    // TODO: proper permissioning
    // deno: {
    //   namespace: true,
    //   permissions: {
    //     sys: true,
    //     net: true,
    //     read: ["."],
    //     hrtime: false,
    //     write: false,
    //     run: false,
    //     ffi: false,
    //     env: true,
    //   } as Deno.PermissionOptions,
    // },
  } as WorkerOptions);

  const promise = new Promise<DriverResponse>((resolve, reject) => {
    worker.onmessage = (evt: MessageEvent<DriverResponse>) => {
      const res = evt.data;
      resolve(res);
    };
    worker.onmessageerror = (evt) => {
      reject(evt.data);
    };
    worker.onerror = (err) => {
      reject(err);
    };
  });
  worker.postMessage(req);
  const resp = await promise;
  worker.terminate();
  return resp;
}
