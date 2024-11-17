//// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

import logger, { setup as setupLogger } from "../../utils/logger.ts";
import { inWorker } from "../../utils/mod.ts";
import { PortBase } from "./base.ts";
import type {
  DenoWorkerPortManifestX,
  DownloadArgs,
  ExecEnvArgs,
  InstallArgs,
  ListAllArgs,
  ListBinPathsArgs,
} from "./types.ts";
import { absoluteFileUrl } from "../../utils/url.ts";

if (inWorker()) {
  initWorker();
}

function initWorker() {
  setupLogger();

  self.onmessage = onMsg;
}

async function onMsg(msg: MessageEvent<WorkerReq>) {
  const req = msg.data;
  if (!req.ty) {
    logger().error("invalid worker request", req);
    throw new Error("unrecognized worker request type");
  }

  // get the Port class exported from the module
  const moduleSpecifier = absoluteFileUrl(req.moduleSpecifier);
  const { Port } = await import(moduleSpecifier);
  if (typeof Port != "function") {
    throw new Error(
      `export "Port" of module ${moduleSpecifier} is not a function`,
    );
  }
  const portCtor = Port as unknown as new () => PortBase;
  const port = new portCtor();

  let res: WorkerResp;
  if (req.ty == "listAll") {
    res = {
      ty: req.ty,
      // id: req.id,
      payload: await port.listAll(req.arg),
    };
  } else if (req.ty === "latestStable") {
    res = {
      ty: req.ty,
      payload: await port.latestStable(req.arg),
    };
  } else if (req.ty === "execEnv") {
    res = {
      ty: req.ty,
      payload: await port.execEnv(req.arg),
    };
  } else if (req.ty === "listBinPaths") {
    res = {
      ty: req.ty,
      payload: await port.listBinPaths(req.arg),
    };
  } else if (req.ty === "listLibPaths") {
    res = {
      ty: req.ty,
      payload: await port.listLibPaths(req.arg),
    };
  } else if (req.ty === "listIncludePaths") {
    res = {
      ty: req.ty,
      payload: await port.listIncludePaths(req.arg),
    };
  } else if (req.ty === "download") {
    await port.download(req.arg),
      res = {
        ty: req.ty,
      };
  } else if (req.ty === "install") {
    await port.install(req.arg),
      res = {
        ty: req.ty,
      };
  } else {
    logger().error("unrecognized worker request type", req);
    throw new Error("unrecognized worker request type");
  }
  self.postMessage(res);
}

type WorkerReq =
  & {
    moduleSpecifier: string;
  }
  & ({
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
  });

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

/**
 * This creates a new worker for every method invocation.
 */
export class DenoWorkerPort extends PortBase {
  constructor(
    public manifest: DenoWorkerPortManifestX,
  ) {
    super();
  }

  /**
   * Create new worker and perform "RPC".
   */
  async call(
    req: WorkerReq,
  ): Promise<WorkerResp> {
    const worker = new Worker(import.meta.url, {
      name: `${this.manifest.name}@${this.manifest.version}`,
      type: "module",
      // TODO: proper permissions
    });
    // promise that resolves when worker replies
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

    // do "RPC"
    worker.postMessage(req);
    const resp = await promise;

    worker.terminate();
    return resp;
  }

  async listAll(args: ListAllArgs) {
    const req: WorkerReq = {
      ty: "listAll",
      // id: crypto.randomUUID(),
      arg: args,
      moduleSpecifier: this.manifest.moduleSpecifier,
    };
    const res = await this.call(req);
    if (res.ty == "listAll") {
      return res.payload;
    }
    throw new Error(`unexpected response from worker ${JSON.stringify(res)}`);
  }

  override async latestStable(env: ListAllArgs) {
    const req: WorkerReq = {
      ty: "latestStable",
      arg: env,
      moduleSpecifier: this.manifest.moduleSpecifier,
    };
    const res = await this.call(req);
    if (res.ty == "latestStable") {
      return res.payload;
    }
    throw new Error(`unexpected response from worker ${JSON.stringify(res)}`);
  }

  override async execEnv(
    args: ExecEnvArgs,
  ) {
    const req: WorkerReq = {
      ty: "execEnv",
      arg: args,
      moduleSpecifier: this.manifest.moduleSpecifier,
    };
    const res = await this.call(req);
    if (res.ty == "execEnv") {
      return res.payload;
    }
    throw new Error(`unexpected response from worker ${JSON.stringify(res)}`);
  }
  override async listBinPaths(
    args: ListBinPathsArgs,
  ) {
    const req: WorkerReq = {
      ty: "listBinPaths",
      arg: args,
      moduleSpecifier: this.manifest.moduleSpecifier,
    };
    const res = await this.call(req);
    if (res.ty == "listBinPaths") {
      return res.payload;
    }
    throw new Error(`unexpected response from worker ${JSON.stringify(res)}`);
  }

  override async listLibPaths(
    args: ListBinPathsArgs,
  ) {
    const req: WorkerReq = {
      ty: "listLibPaths",
      arg: args,
      moduleSpecifier: this.manifest.moduleSpecifier,
    };
    const res = await this.call(req);
    if (res.ty == "listLibPaths") {
      return res.payload;
    }
    throw new Error(`unexpected response from worker ${JSON.stringify(res)}`);
  }

  override async listIncludePaths(
    args: ListBinPathsArgs,
  ) {
    const req: WorkerReq = {
      ty: "listIncludePaths",
      arg: args,
      moduleSpecifier: this.manifest.moduleSpecifier,
    };
    const res = await this.call(req);
    if (res.ty == "listIncludePaths") {
      return res.payload;
    }
    throw new Error(`unexpected response from worker ${JSON.stringify(res)}`);
  }

  override async download(args: DownloadArgs) {
    const req: WorkerReq = {
      ty: "download",
      arg: args,
      moduleSpecifier: this.manifest.moduleSpecifier,
    };
    const res = await this.call(req);
    if (res.ty == "download") {
      return;
    }
    throw new Error(`unexpected response from worker ${JSON.stringify(res)}`);
  }
  override async install(args: InstallArgs) {
    const req: WorkerReq = {
      ty: "install",
      arg: args,
      moduleSpecifier: this.manifest.moduleSpecifier,
    };
    const res = await this.call(req);
    if (res.ty == "install") {
      return;
    }
    throw new Error(`unexpected response from worker ${JSON.stringify(res)}`);
  }
}
