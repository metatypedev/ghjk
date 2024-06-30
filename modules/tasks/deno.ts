//! this loads the ghjk.ts module and executes
//! a task command

//// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import { std_url } from "../../deps/common.ts";

import { inWorker } from "../../utils/mod.ts";
import logger, { setup as setupLogger } from "../../utils/logger.ts";
import { shimDenoNamespace } from "../../utils/worker.ts";

if (inWorker()) {
  initWorker();
}

function initWorker() {
  setupLogger();

  self.onmessage = onMsg;
}

export type DriverRequests = {
  ty: "exec";
  uri: string;
  args: ExecTaskArgs;
};

export type DriverResponse = {
  ty: "execSuccess";
  payload: boolean;
} | {
  ty: "execError";
  payload: unknown;
};

export type ExecTaskArgs = {
  key: string;
  argv: string[];
  workingDir: string;
  envVars: Record<string, string>;
};

async function onMsg(msg: MessageEvent<DriverRequests>) {
  const req = msg.data;
  if (!req.ty) {
    logger().error(`invalid msg data`, req);
    throw new Error(`unrecognized event data`);
  }
  let res: DriverResponse;
  if (req.ty == "exec") {
    try {
      await importAndExec(req.uri, req.args);
      res = {
        ty: "execSuccess",
        payload: true,
      };
    } catch (err) {
      res = {
        ty: "execError",
        payload: err,
      };
    }
  } else {
    logger().error(`invalid DriverRequest type`, req);
    throw new Error(`unrecognized request type: ${req.ty}`);
  }
  self.postMessage(res);
}

async function importAndExec(
  uri: string,
  args: ExecTaskArgs,
) {
  const _shimHandle = shimDenoNamespace(args.envVars);
  const mod = await import(uri);
  await mod.sophon.execTask(args);
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
      evt.preventDefault();
      reject(evt.data);
    };
    worker.onerror = (err) => {
      err.preventDefault();
      reject(err);
    };
  });
  worker.postMessage(req);
  const resp = await promise;
  worker.terminate();
  return resp;
}

export async function execTaskDeno(
  moduleUri: string,
  args: ExecTaskArgs,
) {
  const resp = await rpc(moduleUri, {
    ty: "exec",
    uri: moduleUri,
    args,
  });
  if (resp.ty == "execSuccess") {
    //
  } else if (resp.ty == "execError") {
    throw resp.payload;
  } else {
    throw new Error(`invalid response type: ${(resp as any).ty}`);
  }
}
