//! this loads the ghjk.ts module and provides a program for it

import { std_url } from "../deps/common.ts";

export type DriverRequests = {
  ty: "serialize";
  uri: string;
  envVars: Record<string, string>;
};
export type DriverResponse = {
  ty: "serialize";
  payload: {
    config: unknown;
    accessedEnvKeys: string[];
    readFiles: string[];
    listedFiles: string[];
  };
};

export async function getSerializedConfig(
  configUri: string,
  envVars: Record<string, string>,
) {
  const resp = await rpc(configUri, {
    ty: "serialize",
    uri: configUri,
    envVars,
  });
  if (resp.ty != "serialize") {
    throw new Error(`invalid response type: ${resp.ty}`);
  }
  return resp.payload;
}

async function rpc(moduleUri: string, req: DriverRequests) {
  const baseName = std_url.basename(moduleUri);
  const dirBaseName = std_url.basename(std_url.dirname(moduleUri));
  const worker = new Worker(import.meta.resolve("./worker.ts"), {
    name: `${dirBaseName}/${baseName}`,
    type: "module",
    // TODO: proper permissioning
    deno: {
      namespace: true,
      permissions: {
        sys: true,
        net: true,
        // read: ["."],
        // FIXME: importing js file from disk triggers read perms
        // shim it as well
        read: true,
        env: true,
        hrtime: false,
        write: false,
        run: false,
        ffi: false,
      } as Deno.PermissionOptions,
    },
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
