/// <reference lib="deno.worker" />

// class re-exports are tricky. We want al importers
// of path to get it from here so we rename in common.ts
export { _DaxPath as Path } from "./deps.ts";

import {
  _DaxPath as Path,
  dax,
  json_canonicalize,
  multibase32,
  multihasher,
  multisha2,
  std_fs,
  std_path,
  syncSha256,
  zod,
  zod_val_err,
} from "./deps.ts";
import logger, { isColorfulTty } from "./logger.ts";
// NOTE: only use type imports only when getting stuff from "./sys_deno"
import type { OsEnum } from "../sys_deno/ports/types.ts";

export type DeArrayify<T> = T extends Array<infer Inner> ? Inner : T;
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
  logger().debug("DBG", val, ...more);
  return val;
}

const syncSha256Hasher = multihasher.from({
  code: multisha2.sha256.code,
  name: multisha2.sha256.name,
  encode: (input) => syncSha256(input),
});

export async function bufferHashAsync(
  buf: Uint8Array,
) {
  const hashBuf = await multisha2.sha256.digest(buf);
  const hashStr = multibase32.base32.encode(hashBuf.bytes);
  return hashStr;
}

export function bufferHash(
  buf: Uint8Array,
) {
  const hashBuf = syncSha256Hasher.digest(buf);
  if (hashBuf instanceof Promise) throw new Error("impossible");
  const hashStr = multibase32.base32.encode(hashBuf.bytes);
  return hashStr;
}

export function stringHash(
  val: string,
) {
  const arr = new TextEncoder().encode(val);
  return bufferHash(arr);
}

export function objectHash(
  object: Json,
) {
  return stringHash(json_canonicalize(object));
}

export function defaultCommandBuilder() {
  const builder = new dax.CommandBuilder()
    .printCommand(true);
  builder.setPrintCommandLogger((cmd) => {
    // clean up the already colorized print command logs
    return logger().debug(`spawning: ${cmd}`);
  });
  return builder;
}

let requestBuilder;
try {
  requestBuilder = new dax.RequestBuilder()
    .showProgress(Deno.stderr.isTerminal())
    .timeout(Deno.env.get("GHJK_REQ_TIMEOUT") as any ?? "5m");
} catch (err) {
  throw new Error(
    `invalid timeout param on GHJK_REQ_TIMEOUT: ${
      Deno.env.get("GHJK_REQ_TIMEOUT")
    }`,
    { cause: err },
  );
}

export const $ = dax.build$(
  {
    commandBuilder: defaultCommandBuilder(),
    requestBuilder,
    extras: {
      mapObject<
        O,
        V2,
      >(
        obj: O,
        map: (key: keyof O, val: O[keyof O]) => [string, V2],
      ): Record<string, V2> {
        return Object.fromEntries(
          Object.entries(obj as object).map(([key, val]) =>
            map(key as keyof O, val as O[keyof O])
          ),
        );
      },
      exponentialBackoff(initialDelayMs: number) {
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
      },
      inspect(val: unknown) {
        return Deno.inspect(val, {
          colors: isColorfulTty(),
          iterableLimit: 500,
          depth: 10,
        });
      },

      co: ((values: any[]) => Promise.all(values)) as typeof Promise.all,
      co2: function co2<T extends any[]>(
        ...values: { [K in keyof T]: PromiseLike<T[K]> }
      ) {
        return Promise.all(values) as Promise<T>;
      },
      collector: promiseCollector,

      pathToString(path: Path) {
        return path.toString();
      },
      async removeIfExists(path: Path | string) {
        const pathRef = $.path(path);
        try {
          await pathRef.remove({ recursive: true });
        } catch (err) {
          if (err! instanceof Error && err.name != "NotFound") {
            throw err;
          }
        }
        return pathRef;
      },
      dbg,
    },
  },
);

export function inWorker() {
  return typeof WorkerGlobalScope !== "undefined" &&
    self instanceof WorkerGlobalScope;
}

export async function findEntryRecursive(path: string | Path, name: string) {
  let current = $.path(path);
  while (true) {
    const location = `${current}/${name}`;
    // deno-lint-ignore no-await-in-loop
    if (await $.path(location).exists()) {
      return location;
    }
    const nextCurrent = $.path(current).parent();
    if (!nextCurrent) {
      break;
    }
    current = nextCurrent;
  }
}

export const AVAIL_CONCURRENCY = Number.parseInt(
  Deno.env.get("DENO_JOBS") ?? "1",
);

if (Number.isNaN(AVAIL_CONCURRENCY)) {
  throw new Error(`Value of DENO_JOBS is NAN: ${Deno.env.get("DENO_JOBS")}`);
}

export async function importRaw(spec: string, timeout: dax.Delay = "1m") {
  const url = new URL(spec);
  if (url.protocol == "file:") {
    return await $.path(url.pathname).readText();
  }
  if (url.protocol.match(/^http/)) {
    let request = $.request(url).timeout(timeout);
    const integrity = url.searchParams.get("integrity");
    if (integrity) {
      request = request.integrity(integrity);
    }
    return await request.text();
  }
  throw new Error(
    `error importing raw from ${spec}: unrecognized protocol ${url.protocol}`,
  );
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
 * FIXME: this has a shameful apisucks
 */
export async function downloadFile(
  args: DownloadFileArgs,
) {
  logger().debug("downloading", args);
  const { name, mode, url, downloadPath, tmpDirPath, headers } = {
    name: $.path(args.url).basename(),
    mode: 0o666,
    headers: {},
    ...args,
  };

  const fileDwnPath = $.path(downloadPath).join(name);
  if (await fileDwnPath.exists()) {
    logger().debug(`file ${name} already downloaded, skipping`);
    return;
  }
  const tmpFilePath = (await $.path(tmpDirPath).ensureDir()).join(name);

  await $.request(url)
    .header(headers)
    .timeout(undefined)
    .pipeToPath(tmpFilePath, { create: true, mode });

  await $.path(downloadPath).ensureDir();

  await tmpFilePath.copy(fileDwnPath);
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
 * ```ts
 * let val: number = 1;
 * {
 *    await using myVar = asyncRc("test", async () => { val -=1; })
 *    if (val != 1) throw new Error("impossible")
 * }
 * //FIXME: type hints in doc tests are broken so we +0 to cast it to number.
 * if ((val + 0) != 0) throw new Error("impossible")
 * ```
 */
export function asyncRc<T>(val: T, onDrop: (val: T) => Promise<any>) {
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

export type OrRetOf<T> = T extends () => infer Inner ? Inner : T;

/**
 * This tries to emulate a rust `match` statement but in a typesafe
 * way. This is a WIP function.
 * ```ts
 * const pick: 2 = switchMap(
 *   "hello",
 *   {
 *     hey: () => 1,
 *     hello: () => 2,
 *     hi: 3,
 *     holla: 4,
 *   },
 * );
 * ```
 */
export function switchMap<
  const All extends Record<string | number | symbol, unknown>,
  const K extends string | number | symbol = string,
>(
  val: K,
  branches: All,
): K extends keyof All ? OrRetOf<All[K]> : undefined {
  const branch = branches[val];
  return typeof branch == "function" ? branch() : branch;
}

export async function expandGlobsAndAbsolutize(
  path: string,
  wd: string,
  opts?: Omit<std_fs.ExpandGlobOptions, "root">,
) {
  if (std_path.isGlob(path)) {
    const glob = std_path.isAbsolute(path)
      ? path
      : std_path.joinGlobs([wd, path], { extended: true });
    return (await Array.fromAsync(std_fs.expandGlob(glob, opts)))
      .map((entry) => std_path.resolve(wd, entry.path));
  }
  return [std_path.resolve(wd, path)];
}

/**
 * Unwrap the result object returned by the `safeParse` method
 * on zod schemas.
 */
export function unwrapZodRes<In, Out>(
  res: zod.SafeParseReturnType<In, Out>,
  cause: object = {},
  errMessage = "error parsing object",
) {
  if (!res.success) {
    const zodErr = zod_val_err.fromZodError(res.error, {
      includePath: true,
      maxIssuesInMessage: 3,
      prefix: errMessage,
    });
    zodErr.cause = {
      ...cause,
    };
    throw zodErr;
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
 * {@inheritDoc detectShellPath}
 */
export async function detectShell(): Promise<string | undefined> {
  const shellPath = await detectShellPath();
  return shellPath
    ? std_path.basename(shellPath, ".exe").toLowerCase().trim()
    : undefined;
}

export function isInWorkerContext() {
  return typeof WorkerGlobalScope !== "undefined" &&
    self instanceof WorkerGlobalScope;
}

const fsRepoRoot = import.meta.filename
  ? new URL(import.meta.resolve("../../"))
  : undefined;

/**
 * Useful for url resolution when running ghjk from the disk.
 */
export function relativeToRepoRoot(url: string) {
  if (fsRepoRoot) {
    const moduleUrl = new URL(url);
    if (moduleUrl.protocol === "file:") {
      moduleUrl.protocol = "file+relative:";
      moduleUrl.pathname = "./" + std_path.relative(
        fsRepoRoot.pathname,
        moduleUrl.pathname,
      );
      return moduleUrl.href;
    }
  }
  return url;
}

export function absoluteFromRepoRoot(url: string) {
  if (fsRepoRoot) {
    const moduleUrl = new URL(url);
    if (moduleUrl.protocol === "file:") {
      moduleUrl.pathname = std_path.resolve(
        fsRepoRoot.pathname,
        "./" + moduleUrl.pathname,
      );
      return moduleUrl.href;
    }
  }
  return url;
}

/**
 * Collect promises and await them in the end.
 */
export function promiseCollector<T>(promises: Promise<T>[] = []) {
  return {
    push(promise: (() => Promise<T>) | Promise<T>) {
      promises.push(typeof promise == "function" ? promise() : promise);
    },
    finish() {
      return Promise.all(promises);
    },
  };
}
