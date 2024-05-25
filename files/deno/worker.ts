//! this loads the ghjk.ts module and provides a program for it

//// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

// all imports in here should be dynamic imports as we want to
// modify the Deno namespace before anyone touches it

// NOTE: only import types
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

function shimDenoNamespace(envVars: Record<string, string>) {
  const { envShim, getAccessedEnvKeys } = denoEnvShim(envVars);
  Object.defineProperty(Deno, "env", {
    value: envShim,
  });
  const { fsShims, getReadFiles, getListedFiles } = denoFsReadShim();
  for (const [name, shim] of fsShims) {
    Object.defineProperty(Deno, name, {
      value: shim,
    });
  }
  return { getAccessedEnvKeys, getReadFiles, getListedFiles };
}

function denoFsReadShim() {
  const readFiles = new Set<string>();
  const listedFiles = new Set<string>();

  const fsShims = [
    ["watchFs", () => {
      throw new Error("Deno.watchFs API is disabled");
    }] as const,
    ...[
      // TODO: systemize a way to make sure this
      // tracks deno APIs
      Deno.readFile,
      Deno.readTextFileSync,
      Deno.readTextFile,
      Deno.readTextFileSync,
      Deno.stat,
      Deno.statSync,
      Deno.lstat,
      Deno.lstatSync,
      Deno.readLink,
      Deno.readLinkSync,
      Deno.open,
      Deno.openSync,
      Deno.readDir,
      Deno.readDirSync,
    ].map((old) => {
      const replace = (
        path: string | URL,
        opts: Deno.ReadFileOptions | Deno.OpenOptions | undefined,
      ) => {
        readFiles.add(typeof path == "string" ? path : path.pathname);
        return (old as any)(path, opts);
      };
      return [old.name, replace] as const;
    }),
  ];
  {
    const old = Deno.readDir;
    const replace: typeof old = (
      path: string | URL,
    ) => {
      let parent = typeof path === "string" ? path : path.pathname;
      readFiles.add(parent);
      if (!parent.endsWith("/")) {
        parent = path + "/";
      }
      const oldIteratorFn = old(path)[Symbol.asyncIterator];
      return {
        [Symbol.asyncIterator]: () => {
          const iter = oldIteratorFn();
          return {
            throw: iter.throw,
            return: iter.return,
            async next() {
              const val = await iter.next();
              if (val.done) return val;
              listedFiles.add(parent + val.value.name);
              return val;
            },
          };
        },
      };
    };
    fsShims.push(["readDir", replace]);
  }
  {
    const old = Deno.readDirSync;
    const replace: typeof old = (
      path: string | URL,
    ) => {
      let parent = typeof path === "string" ? path : path.pathname;
      readFiles.add(parent);
      if (!parent.endsWith("/")) {
        parent = path + "/";
      }
      const oldIteratorFn = old(path)[Symbol.iterator];
      return {
        [Symbol.iterator]: () => {
          const iter = oldIteratorFn();
          return {
            throw: iter.throw,
            return: iter.return,
            next() {
              const val = iter.next();
              if (val.done) return val;
              listedFiles.add(parent + val.value.name);
              return val;
            },
          };
        },
      };
    };
    fsShims.push(["readDirSync", replace]);
  }
  return {
    fsShims,
    getReadFiles() {
      return [...readFiles.keys()];
    },
    getListedFiles() {
      return [...listedFiles.keys()];
    },
  };
}

function denoEnvShim(vars: Record<string, string>) {
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
