// NOTE: do not import anything into here since we
// want to change the Deno object before anyone

export function shimDenoNamespace(envVars: Record<string, string>) {
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
    const replace = (path: string | URL) => {
      let parent = typeof path === "string" ? path : path.pathname;
      readFiles.add(parent);
      if (!parent.endsWith("/")) {
        parent = path + "/";
      }
      return old(path).map((val) => {
        listedFiles.add(parent + val.name);
        return val;
      });
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
