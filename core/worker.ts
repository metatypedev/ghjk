//// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import logger from "./logger.ts";
import {
  type DenoWorkerPlugManifestX,
  type DownloadEnv,
  type ExecPathEnv,
  type InstallEnv,
  type ListAllEnv,
  type ListBinPathsEnv,
  Plug,
} from "./types.ts";

type WorkerReq =
  & {
    ty: string;
    id: string;
  }
  & ({
    ty: "listAll";
    arg: ListAllEnv;
  } | {
    ty: "download";
  } | {
    ty: "install";
  });

type WorkerResp =
  & {
    id: string;
  }
  & ({
    ty: "listAll";
    payload: string[];
  } | {
    ty: "download";
  });

/// Make sure to call this before any `await` point or your
/// plug might miss messages
export function denoWorkerPlug<P extends Plug>(plug: P) {
  if (self.name) {
    self.onmessage = async (msg: MessageEvent<WorkerReq>) => {
      const req = msg.data;
      if (!req.ty) {
        logger().error("invalid worker request", req);
        throw Error("unrecognized worker request type");
      }
      let res: WorkerResp;
      if (req.ty == "listAll") {
        res = {
          ty: "listAll",
          id: req.id,
          payload: await plug.listAll(req.arg),
        };
      } else {
        logger().error("unrecognized worker request type", req);
        throw Error("unrecognized worker request type");
      }
      self.postMessage(res);
    };
  }
}

export class DenoWorkerPlug extends Plug {
  name: string;
  dependencies: string[];
  worker: Worker;
  eventListenrs: Map<string, (res: WorkerResp) => void> = new Map();
  constructor(public manifest: DenoWorkerPlugManifestX) {
    super();
    this.name = manifest.name;
    this.dependencies = []; // TODO
    this.worker = new Worker(manifest.moduleSpecifier, {
      name: `${manifest.name}:${manifest.version}`,
      type: "module",
    });
    this.worker.onmessage = (evt: MessageEvent<WorkerResp>) => {
      const res = evt.data;
      if (!res.id) {
        logger().error("invalid worker response", res);
        throw Error("unrecognized worker request type");
      }
      const listener = this.eventListenrs.get(res.id);
      if (listener) {
        listener(res);
      } else {
        logger().error("worker response has no listeners", res);
        throw Error("recieved worker response has no listeners");
      }
    };
  }
  terminate() {
    this.worker.terminate();
  }
  async listAll(env: ListAllEnv): Promise<string[]> {
    const id = crypto.randomUUID();
    const req: WorkerReq = {
      ty: "listAll",
      id,
      arg: env,
    };
    const res = await new Promise<WorkerResp>((resolve) => {
      this.eventListenrs.set(id, (res) => resolve(res));
      this.worker.postMessage(req);
    });
    this.eventListenrs.delete(id);
    if (res.ty == "listAll") {
      return res.payload;
    }
    throw Error(`unexpected response from worker ${JSON.stringify(res)}`);
  }
  execEnv(
    env: ExecPathEnv,
  ): Record<string, string> | Promise<Record<string, string>> {
    throw new Error("Method not implemented.");
  }
  listBinPaths(
    env: ListBinPathsEnv,
  ): Record<string, string> | Promise<Record<string, string>> {
    throw new Error("Method not implemented.");
  }
  download(env: DownloadEnv): void | Promise<void> {
    throw new Error("Method not implemented.");
  }
  install(env: InstallEnv): void | Promise<void> {
    throw new Error("Method not implemented.");
  }
}
