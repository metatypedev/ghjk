//// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import logger from "./logger.ts";
import {
  type DenoWorkerPlugManifestX,
  type DownloadArgs,
  type ExecEnvArgs,
  type InstallArgs,
  type ListAllEnv,
  type ListBinPathsArgs,
  PlugBase,
} from "./types.ts";

import { spawn, type SpawnOptions } from "./utils.ts";
export function isWorker() {
  return !!self.name;
}

export function workerSpawn(
  cmd: string[],
  options: Omit<SpawnOptions, "pipeOut" | "pipeErr"> = {},
) {
  // const outDecoder = new TextDecoderStream();
  // const errDecoder = new TextDecoderStream();
  // outDecoder.readable.pipeTo(
  //   new WritableStream({
  //     write: console.log,
  //   }),
  // );
  // errDecoder.readable.pipeTo(
  //   new WritableStream({
  //     write: console.error,
  //   }),
  // );
  return spawn(cmd, {
    ...options,
    // pipeOut: outDecoder.writable,
    // pipeErr: errDecoder.writable,
  });
}

type WorkerReq = {
  ty: "listAll";
  arg: ListAllEnv;
} | {
  ty: "latestStable";
  arg: ListAllEnv;
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
  if (!isWorker()) {
    throw new Error("expecteing to be running not running in Worker");
  }
  self.onmessage = async (msg: MessageEvent<WorkerReq>) => {
    const req = msg.data;
    if (!req.ty) {
      logger().error("invalid worker request", req);
      throw new Error("unrecognized worker request type");
    }
    let res: WorkerResp;
    if (req.ty == "listAll") {
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

  async listAll(env: ListAllEnv): Promise<string[]> {
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

  async latestStable(env: ListAllEnv): Promise<string> {
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
