//! this loads the ghjk.ts module and executes
//! a task command

//// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import { std_url } from "../../deps/common.ts";

import { inWorker } from "../../utils/mod.ts";
import logger, { setup as setupLogger } from "../../utils/logger.ts";

if (inWorker()) {
  initWorker();
}

function initWorker() {
  setupLogger();

  self.onmessage = onMsg;
}

export type DriverRequests = {
  ty: "exec";
  name: string;
  uri: string;
  args: string[];
};

export type DriverResponse = {
  ty: "exec";
  payload: boolean;
};

async function onMsg(msg: MessageEvent<DriverRequests>) {
  const req = msg.data;
  if (!req.ty) {
    logger().error(`invalid msg data`, req);
    throw new Error(`unrecognized event data`);
  }
  let res: DriverResponse;
  if (req.ty == "exec") {
    res = {
      ty: req.ty,
      payload: await importAndExec(req.uri, req.name, req.args),
    };
  } else {
    logger().error(`invalid DriverRequest type`, req);
    throw new Error(`unrecognized request type: ${req.ty}`);
  }
  self.postMessage(res);
}

async function importAndExec(uri: string, name: string, args: string[]) {
  const mod = await import(uri);
  await mod.ghjk.execTask(name, args);
  return true;
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

export async function execTaskDeno(
  configUri: string,
  name: string,
  args: string[],
) {
  const resp = await rpc(configUri, {
    ty: "exec",
    uri: configUri,
    name,
    args,
  });
  if (resp.ty != "exec") {
    throw new Error(`invalid response type: ${resp.ty}`);
  }
}
