//// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import logger from "../../core/logger.ts";
import {
  type DenoWorkerPlugManifestX,
  type DownloadArgs,
  type ExecEnvArgs,
  type InstallArgs,
  type ListAllArgs,
  type ListBinPathsArgs,
  PlugBase,
} from "./types.ts";

export function isWorker() {
  return !!self.name;
}

type WorkerReq = {
  ty: "assert";
  arg: {
    moduleSpecifier: string;
  };
} | {
  ty: "listAll";
  arg: ListAllArgs;
} | {
  ty: "latestStable";
  arg: ListAllArgs;
} | {
  ty: "execEnv";
  arg: ExecEnvArgs;
} | {
  ty: "download";
  arg: DownloadArgs;
} | {
  ty: "install";
  arg: InstallArgs;
} | {
  ty: "listBinPaths";
  arg: ListBinPathsArgs;
} | {
  ty: "listLibPaths";
  arg: ListBinPathsArgs;
} | {
  ty: "listIncludePaths";
  arg: ListBinPathsArgs;
};

type WorkerResp = {
  ty: "assert";
  // success
} | {
  ty: "listAll";
  payload: string[];
} | {
  ty: "latestStable";
  payload: string;
} | {
  ty: "listBinPaths";
  payload: string[];
} | {
  ty: "listLibPaths";
  payload: string[];
} | {
  ty: "listIncludePaths";
  payload: string[];
} | {
  ty: "execEnv";
  payload: Record<string, string>;
} | {
  ty: "download";
} | {
  ty: "install";
};

/// Make sure to call this before any `await` point or your
/// plug might miss messages
export function initDenoWorkerPlug<P extends PlugBase>(plugInit: () => P) {
  if (isWorker()) {
    // let plugClass: (new () => PlugBase) | undefined;
    // const plugInit = () => {
    //   if (!plugClass) {
    //     throw new Error("worker yet to be initialized");
    //   }
    //   return new plugClass();
    // };
    self.onmessage = async (msg: MessageEvent<WorkerReq>) => {
      const req = msg.data;
      if (!req.ty) {
        logger().error("invalid worker request", req);
        throw new Error("unrecognized worker request type");
      }
      let res: WorkerResp;
      if (req.ty == "assert") {
        throw new Error("not yet impl");
        /* const { default: defExport } = await import(req.arg.moduleSpecifier);
        if (typeof defExport != "function") {
          throw new Error(
            `default export of module ${req.arg.moduleSpecifier} is not a function`,
          );
        }
        plugClass = defExport;
        res = {
          ty: req.ty,
        }; */
      } else if (req.ty == "listAll") {
        res = {
          ty: req.ty,
          // id: req.id,
          payload: await plugInit().listAll(req.arg),
        };
      } else if (req.ty === "latestStable") {
        res = {
          ty: req.ty,
          payload: await plugInit().latestStable(req.arg),
        };
      } else if (req.ty === "execEnv") {
        res = {
          ty: req.ty,
          payload: await plugInit().execEnv(req.arg),
        };
      } else if (req.ty === "listBinPaths") {
        res = {
          ty: req.ty,
          payload: await plugInit().listBinPaths(req.arg),
        };
      } else if (req.ty === "listLibPaths") {
        res = {
          ty: req.ty,
          payload: await plugInit().listLibPaths(req.arg),
        };
      } else if (req.ty === "listIncludePaths") {
        res = {
          ty: req.ty,
          payload: await plugInit().listIncludePaths(req.arg),
        };
      } else if (req.ty === "download") {
        await plugInit().download(req.arg),
          res = {
            ty: req.ty,
          };
      } else if (req.ty === "install") {
        await plugInit().install(req.arg),
          res = {
            ty: req.ty,
          };
      } else {
        logger().error("unrecognized worker request type", req);
        throw new Error("unrecognized worker request type");
      }
      self.postMessage(res);
    };
  } else {
    throw new Error("expecting to be running not running in Worker");
  }
}
// type MethodKeys<T> = {
//   [P in keyof T]-?: T[P] extends Function ? P : never;
// }[keyof T];

export class DenoWorkerPlug extends PlugBase {
  constructor(
    public manifest: DenoWorkerPlugManifestX,
  ) {
    super();
  }

  /// This creates a new worker on every call
  async call(
    req: WorkerReq,
  ): Promise<WorkerResp> {
    const worker = new Worker(this.manifest.moduleSpecifier, {
      name: `${this.manifest.name}@${this.manifest.version}`,
      type: "module",
    });
    const promise = new Promise<WorkerResp>((resolve, reject) => {
      worker.onmessage = (evt: MessageEvent<WorkerResp>) => {
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

  async listAll(env: ListAllArgs): Promise<string[]> {
    const req: WorkerReq = {
      ty: "listAll",
      // id: crypto.randomUUID(),
      arg: env,
    };
    const res = await this.call(req);
    if (res.ty == "listAll") {
      return res.payload;
    }
    throw new Error(`unexpected response from worker ${JSON.stringify(res)}`);
  }

  async latestStable(env: ListAllArgs): Promise<string> {
    const req: WorkerReq = {
      ty: "latestStable",
      arg: env,
    };
    const res = await this.call(req);
    if (res.ty == "latestStable") {
      return res.payload;
    }
    throw new Error(`unexpected response from worker ${JSON.stringify(res)}`);
  }

  async execEnv(
    env: ExecEnvArgs,
  ): Promise<Record<string, string>> {
    const req: WorkerReq = {
      ty: "execEnv",
      arg: env,
    };
    const res = await this.call(req);
    if (res.ty == "execEnv") {
      return res.payload;
    }
    throw new Error(`unexpected response from worker ${JSON.stringify(res)}`);
  }
  async listBinPaths(
    env: ListBinPathsArgs,
  ): Promise<string[]> {
    const req: WorkerReq = {
      ty: "listBinPaths",
      arg: env,
    };
    const res = await this.call(req);
    if (res.ty == "listBinPaths") {
      return res.payload;
    }
    throw new Error(`unexpected response from worker ${JSON.stringify(res)}`);
  }

  async listLibPaths(
    env: ListBinPathsArgs,
  ): Promise<string[]> {
    const req: WorkerReq = {
      ty: "listLibPaths",
      arg: env,
    };
    const res = await this.call(req);
    if (res.ty == "listLibPaths") {
      return res.payload;
    }
    throw new Error(`unexpected response from worker ${JSON.stringify(res)}`);
  }

  async listIncludePaths(
    env: ListBinPathsArgs,
  ): Promise<string[]> {
    const req: WorkerReq = {
      ty: "listIncludePaths",
      arg: env,
    };
    const res = await this.call(req);
    if (res.ty == "listIncludePaths") {
      return res.payload;
    }
    throw new Error(`unexpected response from worker ${JSON.stringify(res)}`);
  }

  async download(env: DownloadArgs): Promise<void> {
    const req: WorkerReq = {
      ty: "download",
      arg: env,
    };
    const res = await this.call(req);
    if (res.ty == "download") {
      return;
    }
    throw new Error(`unexpected response from worker ${JSON.stringify(res)}`);
  }
  async install(env: InstallArgs): Promise<void> {
    const req: WorkerReq = {
      ty: "install",
      arg: env,
    };
    const res = await this.call(req);
    if (res.ty == "install") {
      return;
    }
    throw new Error(`unexpected response from worker ${JSON.stringify(res)}`);
  }
}
