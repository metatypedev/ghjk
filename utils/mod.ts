import {
  dax,
  jsonHash,
  std_fs,
  std_path,
  std_url,
  zod,
} from "../deps/common.ts";
import logger, { isColorfulTty } from "./logger.ts";
// NOTE: only use type imports only when getting stuff from "./modules"
import type {
  DepArts,
  InstallConfigFat,
  InstallConfigResolvedX,
  OsEnum,
  PortDep,
  PortManifest,
} from "../modules/ports/types.ts";

export type DePromisify<T> = T extends Promise<infer Inner> ? Inner : T;
const literalSchema = zod.union([
  zod.string(),
  zod.number(),
  zod.boolean(),
  zod.null(),
]);
export type JsonLiteral = zod.infer<typeof literalSchema>;
export type JsonObject = { [key: string]: Json };
export type JsonArray = Json[];
export type Json = JsonLiteral | JsonObject | JsonArray;
export const jsonSchema: zod.ZodType<Json> = zod.lazy(() =>
  zod.union([literalSchema, zod.array(jsonSchema), zod.record(jsonSchema)])
);

export function dbg<T>(val: T, ...more: unknown[]) {
  logger().debug(() => val, ...more, "DBG");
  return val;
}

export function pathsWithDepArts(
  depArts: DepArts,
  os: OsEnum,
) {
  const pathSet = new Set();
  const libSet = new Set();
  const includesSet = new Set();
  for (const [_, { execs, libs, includes }] of Object.entries(depArts)) {
    for (const [_, binPath] of Object.entries(execs)) {
      pathSet.add(std_path.dirname(binPath));
    }
    for (const [_, libPath] of Object.entries(libs)) {
      libSet.add(std_path.dirname(libPath));
    }
    for (const [_, incPath] of Object.entries(includes)) {
      includesSet.add(std_path.dirname(incPath));
    }
  }

  let LD_LIBRARY_ENV: string;
  switch (os) {
    case "darwin":
      LD_LIBRARY_ENV = "DYLD_LIBRARY_PATH";
      break;
    case "linux":
      LD_LIBRARY_ENV = "LD_LIBRARY_PATH";
      break;
    default:
      throw new Error(`unsupported os ${os}`);
  }
  return {
    PATH: `${[...pathSet.keys()].join(":")}:${Deno.env.get("PATH") ?? ""}`,
    LIBRARY_PATH: `${[...libSet.keys()].join(":")}:${
      Deno.env.get("LIBRARY_PATH") ?? ""
    }`,
    C_INCLUDE_PATH: `${[...includesSet.keys()].join(":")}:${
      Deno.env.get("C_INCLUDE_PATH") ?? ""
    }`,
    CPLUS_INCLUDE_PATH: `${[...includesSet.keys()].join(":")}:${
      Deno.env.get("CPLUS_INCLUDE_PATH") ?? ""
    }`,
    [LD_LIBRARY_ENV]: `${[...libSet.keys()].join(":")}:${
      Deno.env.get(LD_LIBRARY_ENV) ?? ""
    }`,
  };
}

export function depExecShimPath(
  dep: PortDep,
  execName: string,
  depArts: DepArts,
) {
  const path = tryDepExecShimPath(dep, execName, depArts);
  if (!path) {
    throw new Error(
      `unable to find shim path for bin "${execName}" of dep ${dep.name}`,
    );
  }
  return path;
}

export function depEnv(
  dep: PortDep,
  depArts: DepArts,
) {
  return depArts[dep.name]?.env ?? {};
}

export function tryDepExecShimPath(
  dep: PortDep,
  execName: string,
  depArts: DepArts,
) {
  const shimPaths = depArts[dep.name];
  if (!shimPaths) {
    return;
  }
  // FIXME: match despite `.exe` extension on windows
  const path = shimPaths.execs[execName];
  if (!path) {
    return;
  }
  return path;
}

/**
 * Lifted from https://deno.land/x/hextools@v1.0.0
 * MIT License
 * Copyright (c) 2020 Santiago Aguilar Hernández
 */
export function bufferToHex(buffer: ArrayBuffer): string {
  return Array.prototype.map.call(
    new Uint8Array(buffer),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function bufferHashHex(
  buf: ArrayBuffer,
  algo: AlgorithmIdentifier = "SHA-256",
) {
  const hashBuf = await crypto.subtle.digest(algo, buf);
  return bufferToHex(hashBuf);
}

export async function stringHashHex(
  val: string,
  algo: AlgorithmIdentifier = "SHA-256",
) {
  const arr = new TextEncoder().encode(val);
  return await bufferHashHex(arr, algo);
}

export async function objectHashHex(
  object: jsonHash.Tree,
  algo: jsonHash.DigestAlgorithmType = "SHA-256",
) {
  const hashBuf = await jsonHash.digest(algo, object);
  const hashHex = bufferToHex(hashBuf);
  return hashHex;
}

export function getPortRef(manifest: PortManifest) {
  return `${manifest.name}@${manifest.version}`;
}

export async function getInstallHash(install: InstallConfigResolvedX) {
  const fullHashHex = await objectHashHex(install as jsonHash.Tree);
  const hashHex = fullHashHex.slice(0, 8);
  return `${install.portRef}!${hashHex}`;
}

export type PathRef = dax.PathRef;

export function defaultCommandBuilder() {
  const builder = new dax.CommandBuilder()
    .printCommand(true);
  builder.setPrintCommandLogger((_, cmd) => {
    // clean up the already colorized print command logs
    // TODO: remove when https://github.com/dsherret/dax/pull/203
    // is merged
    return logger().debug(
      "spawning",
      $.stripAnsi(cmd).split(/\s/),
    );
  });
  return builder;
}

export const $ = dax.build$(
  {
    commandBuilder: defaultCommandBuilder(),
    extras: {
      inspect(val: unknown) {
        return Deno.inspect(val, {
          colors: isColorfulTty(),
          iterableLimit: 500,
        });
      },
      pathToString(path: dax.PathRef) {
        return path.toString();
      },
      async removeIfExists(path: dax.PathRef | string) {
        const pathRef = $.path(path);
        if (await pathRef.exists()) {
          await pathRef.remove({ recursive: true });
        }
      },
    },
  },
);

export function inWorker() {
  return typeof WorkerGlobalScope !== "undefined" &&
    self instanceof WorkerGlobalScope;
}

export async function findConfig(path: string) {
  let current = path;
  while (true) {
    const location = `${current}/ghjk.ts`;
    if (await std_fs.exists(location)) {
      return location;
    }
    const nextCurrent = std_path.dirname(current);
    if (nextCurrent == "/" && current == "/") {
      break;
    }
    current = nextCurrent;
  }
  return null;
}

export function home_dir(): string | null {
  switch (Deno.build.os) {
    case "linux":
    case "darwin":
      return Deno.env.get("HOME") ?? null;
    case "windows":
      return Deno.env.get("USERPROFILE") ?? null;
    default:
      return null;
  }
}

export function dirs() {
  const home = home_dir();
  if (!home) {
    throw new Error("cannot find home dir");
  }
  return {
    homeDir: home,
    shareDir: std_path.resolve(home, ".local", "share"),
  };
}

export const AVAIL_CONCURRENCY = Number.parseInt(
  Deno.env.get("DENO_JOBS") ?? "1",
);

if (Number.isNaN(AVAIL_CONCURRENCY)) {
  throw new Error(`Value of DENO_JOBS is NAN: ${Deno.env.get("DENO_JOBS")}`);
}

export async function importRaw(spec: string) {
  const url = new URL(spec);
  if (url.protocol == "file:") {
    return await Deno.readTextFile(url.pathname);
  }
  if (url.protocol.match(/^http/)) {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(
        `error importing raw using fetch from ${spec}: ${resp.status} - ${resp.statusText}`,
      );
    }
    return await resp.text();
  }
  throw new Error(
    `error importing raw from ${spec}: unrecognized protocol ${url.protocol}`,
  );
}

export function exponentialBackoff(initialDelayMs: number) {
  let delay = initialDelayMs;
  let attempt = 0;

  return {
    next() {
      if (attempt > 0) {
        delay *= 2;
      }
      attempt += 1;
      return delay;
    },
  };
}

export async function shimScript(
  { shimPath, execPath, os, defArgs, envOverrides, envDefault }: {
    shimPath: string;
    execPath: string;
    os: OsEnum;
    defArgs?: string;
    envOverrides?: Record<string, string>;
    envDefault?: Record<string, string>;
  },
) {
  if (os == "windows") {
    throw new Error("not yet supported");
  }
  await $.path(
    shimPath,
  ).writeText(
    `#!/bin/sh 
${
      [
        ...Object.entries(envDefault ?? {})
          // we let the values be overriden if there's an already set variable of that name
          // also we single quote vals in the first line to avoid expansion
          .map(([key, val]) =>
            `default_${key}='${val}'
${key}="$\{${key}:-$default_${key}}"`
          ),
        ...Object.entries(envOverrides ?? {})
          // single quote vals to avoid expansion
          .map(([key, val]) => `
${key}='${val}'`),
      ]
        .join("\n")
    }
exec ${execPath}${defArgs ? ` ${defArgs}` : ""} $*`,
    // use exec to ensure the scripts executes in it's own shell
    // pass all args to shim to the exec
    { mode: 0o700 },
  );
}

export type DownloadFileArgs = {
  downloadPath: string;
  tmpDirPath: string;
  url: string;
  name?: string;
  mode?: number;
  headers?: Record<string, string>;
};

/**
 * This avoid re-downloading a file if it's already successfully downloaded before.
 */
export async function downloadFile(
  args: DownloadFileArgs,
) {
  const { name, mode, url, downloadPath, tmpDirPath, headers } = {
    name: std_url.basename(args.url),
    mode: 0o666,
    headers: {},
    ...args,
  };

  const fileDwnPath = $.path(downloadPath).join(name);
  if (await fileDwnPath.exists()) {
    logger().debug(`file ${name} already downloaded, skipping`);
    return;
  }
  const tmpFilePath = $.path(tmpDirPath).join(name);

  await $.request(url)
    .header(headers)
    .showProgress()
    .pipeToPath(tmpFilePath, { create: true, mode });

  await $.path(downloadPath).ensureDir();

  await tmpFilePath.copyFile(fileDwnPath);
  return downloadPath.toString();
}

/**
 * This returns a tmp path that's guaranteed to be
 * on the same file system as targetDir by
 * checking if $TMPDIR satisfies that constraint
 * or just pointing to targetDir/tmp
 * This is handy for making moves atomics from
 * tmp dirs to to locations within targetDir
 *
 * Make sure to remove the dir after use
 */
export async function sameFsTmpRoot(
  targetDir: string,
  targetTmpDirName = "tmp",
) {
  const defaultTmp = Deno.env.get("TMPDIR");
  const targetPath = $.path(targetDir);
  if (!defaultTmp) {
    // this doens't return a unique tmp dir on every sync
    // this allows subsequent syncs to clean up after
    // some previously failing sync as this is not a system managed
    // tmp dir but this means two concurrent syncing  will clash
    // TODO: mutex file to prevent block concurrent syncinc
    return await targetPath.join(targetTmpDirName).ensureDir();
  }
  const defaultTmpPath = $.path(defaultTmp);
  if ((await targetPath.stat())?.dev != (await defaultTmpPath.stat())?.dev) {
    return await targetPath.join(targetTmpDirName).ensureDir();
  }
  // when using the system managed tmp dir, we create a new tmp dir in it
  // we don't care if the sync fails before it cleans as the system will
  // take care of it
  return $.path(await Deno.makeTempDir({ prefix: "ghjk_sync" }));
}

export type Rc<T> = ReturnType<typeof rc<T>>;

/**
 * A reference counted box that runs the dispose method when all refernces
 * are disposed of..
 * @example Basic usage
 * ```
 * using myVar = rc(setTimeout(() => console.log("hola)), clearTimeout)
 * spawnOtherThing(myVar.clone());
 * // dispose will only run here as long as `spawnOtherThing` has no references
 * ```
 */
export function rc<T>(val: T, onDrop: (val: T) => void) {
  const rc = {
    counter: 1,
    val,
    clone() {
      rc.counter += 1;
      return rc;
    },
    [Symbol.dispose]() {
      rc.counter -= 1;
      if (rc.counter < 0) {
        throw new Error("reference count is negative", {
          cause: rc,
        });
      }
      if (rc.counter == 0) {
        onDrop(val);
      }
    },
  };
  return rc;
}

export type AsyncRc<T> = ReturnType<typeof asyncRc<T>>;

/**
 * A reference counted box that makse use of `asyncDispose`.
 * `async using myVar = asyncRc(setTimeout(() => console.log("hola)), clearTimeout)`
 */
export function asyncRc<T>(val: T, onDrop: (val: T) => Promise<void>) {
  const rc = {
    counter: 1,
    val,
    clone() {
      rc.counter += 1;
      return rc;
    },
    async [Symbol.asyncDispose]() {
      rc.counter -= 1;
      if (rc.counter < 0) {
        throw new Error("reference count is negative", {
          cause: rc,
        });
      }
      if (rc.counter == 0) {
        await onDrop(val);
      }
    },
  };
  return rc;
}

export function thinInstallConfig(fat: InstallConfigFat) {
  const { port, ...lite } = fat;
  return {
    portRef: getPortRef(port),
    ...lite,
  };
}

export type OrRetOf<T> = T extends () => infer Inner ? Inner : T;

export function switchMap<
  K extends string | number | symbol,
  All extends {
    [Key in K]: All[K];
  },
>(
  val: K,
  branches: All,
  // def?: D,
): K extends keyof All ? OrRetOf<All[K]>
  : /* All[keyof All] | */ undefined {
  // return branches[val];
  const branch = branches[val];
  return typeof branch == "function" ? branch() : branch;
}

switchMap(
  "holla" as string,
  {
    hey: () => 1,
    hello: () => 2,
    hi: 3,
    holla: 4,
  } as const,
  // () =>5
);

export async function expandGlobsAndAbsolutize(path: string, wd: string) {
  if (std_path.isGlob(path)) {
    const glob = std_path.isAbsolute(path)
      ? path
      : std_path.joinGlobs([wd, path], { extended: true });
    return (await Array.fromAsync(std_fs.expandGlob(glob)))
      .map((entry) => std_path.resolve(wd, entry.path));
  }
  return [std_path.resolve(wd, path)];
}

/**
 * Unwrap the result object returned by the `safeParse` method
 * on zod schemas.
 */
export function unwrapParseRes<In, Out>(
  res: zod.SafeParseReturnType<In, Out>,
  cause: object = {},
  errMessage = "error parsing object",
) {
  if (!res.success) {
    throw new Error(errMessage, {
      cause: {
        zodErr: res.error,
        ...cause,
      },
    });
  }
  return res.data;
}

/**
 * Attempts to detect the shell in use by the user.
 */
export async function detectShellPath(): Promise<string | undefined> {
  let path = Deno.env.get("SHELL");
  if (!path) {
    try {
      path = await $`ps -p ${Deno.ppid} -o comm=`.text();
    } catch {
      return;
    }
  }
  return path;
}

/**
 * {@inheritdoc detectShellPath}
 */
export async function detectShell(): Promise<string | undefined> {
  const shellPath = await detectShellPath();
  return shellPath
    ? std_path.basename(shellPath, ".exe").toLowerCase().trim()
    : undefined;
}
