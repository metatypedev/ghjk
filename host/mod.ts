import {
  cliffy_cmd,
  deep_eql,
  jsonHash,
  zod,
  zod_val_err,
} from "../deps/cli.ts";
import logger from "../utils/logger.ts";

import {
  $,
  bufferHashHex,
  Json,
  objectHashHex,
  Path,
  stringHashHex,
} from "../utils/mod.ts";
import validators, { SerializedConfig } from "./types.ts";
import * as std_modules from "../modules/std.ts";
import * as denoFile from "../ghjkfiles/deno/mod.ts";
import type { ModuleBase } from "../modules/mod.ts";
import { GhjkCtx } from "../modules/types.ts";
import { serializePlatform } from "../modules/ports/types/platform.ts";
import { DePromisify } from "../port.ts";

export interface CliArgs {
  ghjkShareDir: string;
  ghjkfilePath?: string;
}

type HostCtx = {
  fileHashMemoStore: Map<string, Promise<string>>;
};

export async function cli(args: CliArgs) {
  const ghjkShareDir = $.path(args.ghjkShareDir).resolve().normalize()
    .toString();
  // items to run at end of function
  const defer = [] as (() => Promise<any>)[];

  const subcmds: Record<string, any> = {};

  let serializedConfig: object | undefined;
  let ghjkDir: string | undefined;
  let ghjkfilePath: string | undefined;

  // most of the CLI is only avail if there's a
  // ghjkfile detected
  if (args.ghjkfilePath) {
    ghjkfilePath = $.path(args.ghjkfilePath).resolve().normalize()
      .toString();
    ghjkDir = $.path(ghjkfilePath).parentOrThrow().join(".ghjk")
      .toString();
    logger().debug({ ghjkfilePath, ghjkDir });

    const gcx = { ghjkShareDir, ghjkfilePath, ghjkDir, blackboard: new Map() };
    const hcx = { fileHashMemoStore: new Map() };

    const {
      subCommands: configCommands,
      serializedConfig: config,
      writeLockFile,
    } = await readConfig(
      gcx,
      hcx,
    );
    serializedConfig = config;
    // lock entries are generated across program usage
    // so we defer writing it out until the end
    defer.push(writeLockFile);

    for (const [cmdName, [cmd, src]] of Object.entries(configCommands)) {
      const conflict = subcmds[cmdName];
      if (conflict) {
        throw new Error(
          `CLI command conflict under name "${cmdName}" from host and module "${src}"`,
        );
      }
      subcmds[cmdName] = cmd;
    }
  }

  const root = new cliffy_cmd.Command()
    .name("ghjk")
    .version("0.1.1") // FIXME: better way to resolve version
    .description("Programmable runtime manager.")
    .action(function () {
      this.showHelp();
    })
    .command(
      "completions",
      new cliffy_cmd.CompletionsCommand(),
    )
    .command(
      "deno",
      new cliffy_cmd.Command()
        .description("Access the deno cli.")
        .useRawArgs()
        .action(async function (_, ...args) {
          logger().debug(args);
          await $.raw`${Deno.execPath()} ${args}`
            .env("DENO_EXEC_PATH", Deno.execPath());
        }),
    )
    .command(
      "print",
      new cliffy_cmd.Command()
        .description("Emit different discovered and built values to stdout.")
        .action(function () {
          this.showHelp();
        })
        .command(
          "share-dir-path",
          new cliffy_cmd.Command()
            .description("Print the path where ghjk is installed in.")
            .action(function () {
              if (!ghjkShareDir) {
                throw new Error("no ghjkfile found.");
              }
              // deno-lint-ignore no-console
              console.log(ghjkShareDir);
            }),
        )
        .command(
          "ghjkdir-path",
          new cliffy_cmd.Command()
            .description("Print the path where ghjk is installed in.")
            .action(function () {
              if (!ghjkDir) {
                throw new Error("no ghjkfile found.");
              }
              // deno-lint-ignore no-console
              console.log(ghjkDir);
            }),
        )
        .command(
          "ghjkfile-path",
          new cliffy_cmd.Command()
            .description("Print the path of the ghjk.ts used")
            .action(function () {
              if (!ghjkfilePath) {
                throw new Error("no ghjkfile found.");
              }
              // deno-lint-ignore no-console
              console.log(ghjkfilePath);
            }),
        )
        .command(
          "config",
          new cliffy_cmd.Command()
            .description(
              "Print the extracted ans serialized config from the ghjkfile",
            )
            .action(function () {
              if (!serializedConfig) {
                throw new Error("no ghjkfile found.");
              }
              // deno-lint-ignore no-console
              console.log($.inspect(serializedConfig));
            }),
        ),
    );
  for (const [name, subcmd] of Object.entries(subcmds)) {
    root.command(name, subcmd);
  }
  await root.parse(Deno.args);
  await Promise.all(defer.map((fn) => fn()));
}

async function readConfig(gcx: GhjkCtx, hcx: HostCtx) {
  const configPath = $.path(gcx.ghjkfilePath);
  const configFileStat = await configPath.stat();
  // FIXME: subset of ghjk commands should be functional
  // even if config file not found
  if (!configFileStat) {
    throw new Error("unable to locate config file", {
      cause: gcx,
    });
  }
  const ghjkDirPath = $.path(gcx.ghjkDir);
  if (!await ghjkDirPath.join(".gitignore").exists()) {
    ghjkDirPath.join(".gitignore").writeText($.dedent`
        envs
        hash.json`);
  }
  const lockFilePath = ghjkDirPath.join("lock.json");
  const hashFilePath = ghjkDirPath.join("hash.json");

  // command name to [cmd, source module id]
  const subCommands = {} as Record<string, [cliffy_cmd.Command, string]>;
  const lockEntries = {} as Record<string, unknown>;

  const foundLockObj = await readLockFile(lockFilePath);
  const foundHashObj = await readHashFile(hashFilePath);

  const ghjkfileHash = await fileDigestHex(hcx, configPath);

  const curEnvVars = Deno.env.toObject();

  let configExt: SerializedConfigExt | null = null;
  // TODO: figure out cross platform lockfiles :O
  if (
    foundLockObj && // lockfile found
    foundLockObj.version == "0"
  ) {
    logger().debug("loading lockfile", lockFilePath);
    for (const man of foundLockObj.config.modules) {
      const mod = std_modules.map[man.id];
      if (!mod) {
        throw new Error(
          `unrecognized module specified by lockfile config: ${man.id}`,
        );
      }
      const entry = foundLockObj.moduleEntries[man.id];
      if (!entry) {
        throw new Error(
          `no lock entry found for module specified by lockfile config: ${man.id}`,
        );
      }
      const instance: ModuleBase<unknown, unknown> = new mod.ctor();
      lockEntries[man.id] = await instance.loadLockEntry(
        gcx,
        entry as Json,
      );
    }

    const platformMatch = () =>
      serializePlatform(Deno.build) == foundLockObj.platform;

    const envHashesMatch = async () => {
      const oldHashes = foundHashObj!.envVarHashes;
      const newHashes = await envVarDigests(curEnvVars, [
        ...Object.keys(oldHashes),
      ]);
      return deep_eql(oldHashes, newHashes);
    };

    const cwd = $.path(Deno.cwd());
    const fileHashesMatch = async () => {
      const oldHashes = foundHashObj!.readFileHashes;
      const newHashes = await fileDigests(hcx, [
        ...Object.keys(oldHashes),
      ], cwd);
      return deep_eql(oldHashes, newHashes);
    };

    const fileListingsMatch = async () => {
      const oldListed = foundHashObj!.listedFiles;
      for (const path of oldListed) {
        if (!await cwd.resolve(path).exists()) {
          return false;
        }
      }
      return true;
    };
    // avoid reserializing the config if
    // the ghjkfile and environment is _satisfcatorily_
    // similar. "cache validation"
    if (
      // NOTE: these are ordered by the amount effort it takes
      // to check each
      foundHashObj &&
      foundHashObj.ghjkfileHash == ghjkfileHash &&
      platformMatch() &&
      await envHashesMatch() &&
      await fileListingsMatch() &&
      await fileHashesMatch()
    ) {
      configExt = {
        config: foundLockObj.config,
        envVarHashes: foundHashObj.envVarHashes,
        readFileHashes: foundHashObj.readFileHashes,
        listedFiles: foundHashObj.listedFiles,
      };
    }
  }

  // configExt will be falsy if no lockfile was found
  // or if it failed cache validation
  if (!configExt) {
    logger().info("serializing ghjkfile", configPath);
    configExt = await readAndSerializeConfig(hcx, configPath, curEnvVars);
  }

  const newHashObj: zod.infer<typeof hashObjValidator> = {
    version: "0",
    ghjkfileHash,
    envVarHashes: configExt.envVarHashes,
    readFileHashes: configExt.readFileHashes,
    listedFiles: configExt.listedFiles,
  };
  const instances = [] as [string, ModuleBase<unknown, unknown>, unknown][];
  for (const man of configExt.config.modules) {
    const mod = std_modules.map[man.id];
    if (!mod) {
      throw new Error(`unrecognized module specified by ghjk.ts: ${man.id}`);
    }
    const instance: ModuleBase<unknown, unknown> = new mod.ctor();
    const pMan = await instance.processManifest(
      gcx,
      man,
      configExt.config.blackboard,
      lockEntries[man.id],
    );
    instances.push([man.id, instance, pMan] as const);
    for (const [cmdName, cmd] of Object.entries(instance.commands(gcx, pMan))) {
      const conflict = subCommands[cmdName];
      if (conflict) {
        throw new Error(
          `CLI command conflict under name "${cmdName}" from modules "${man.id}" & "${
            conflict[1]
          }"`,
        );
      }
      subCommands[cmdName] = [cmd, man.id];
    }
  }
  if (!foundHashObj || !deep_eql(newHashObj, foundHashObj)) {
    await hashFilePath.writeJsonPretty(newHashObj);
  }

  return {
    subCommands,
    serializedConfig: configExt.config,
    async writeLockFile() {
      const newLockObj: zod.infer<typeof lockObjValidator> = {
        version: "0",
        platform: serializePlatform(Deno.build),
        moduleEntries: {} as Record<string, unknown>,
        config: configExt!.config,
      };

      // generate the lock entries after *all* the modules
      // are done processing their config to allow
      // any shared stores to be properly populated
      // e.g. the resolution memo store
      newLockObj.moduleEntries = Object.fromEntries(
        await Array.fromAsync(
          instances.map(
            async (
              [id, instance, pMan],
            ) => [id, await instance.genLockEntry(gcx, pMan)],
          ),
        ),
      );
      // avoid writing lockfile if nothing's changed
      if (!foundLockObj || !deep_eql(newLockObj, foundLockObj)) {
        await lockFilePath.writeJsonPretty(newLockObj);
      }
    },
  };
}

type DigestsMap = Record<string, string | null | undefined>;

type SerializedConfigExt = DePromisify<
  ReturnType<typeof readAndSerializeConfig>
>;

async function readAndSerializeConfig(
  hcx: HostCtx,
  configPath: Path,
  envVars: Record<string, string>,
) {
  switch (configPath.extname()) {
    case "":
      logger().warn("config file has no extension, assuming deno config");
    /* falls through */
    case ".ts": {
      logger().debug("serializing ts config", configPath);
      const res = await denoFile.getSerializedConfig(
        configPath.toFileUrl().href,
        envVars,
      );
      const envVarHashes = await envVarDigests(envVars, res.accessedEnvKeys);
      const cwd = $.path(Deno.cwd());
      const cwdStr = cwd.toString();
      const listedFiles = res.listedFiles
        .map((path) => cwd.resolve(path).toString().replace(cwdStr, "."));
      // FIXME: this breaks if the version of the file the config reads
      // has changed by this point
      // consider reading mtime of files when read by the serializer and comparing
      // them before hashing to make sure we get the same file
      // not sure what to do if it has changed though, re-serialize?
      const readFileHashes = await fileDigests(hcx, res.readFiles, cwd);

      return {
        config: validateRawConfig(res.config, configPath),
        envVarHashes,
        readFileHashes,
        listedFiles,
      };
    }
    // case ".jsonc":
    // case ".json":
    //   raw = await configPath.readJson();
    //   break;
    default:
      throw new Error(
        `unrecognized ghjkfile type provided at path: ${configPath}`,
      );
  }
}

function validateRawConfig(
  raw: unknown,
  configPath: Path,
): SerializedConfig {
  const res = validators.serializedConfig.safeParse(raw);
  if (!res.success) {
    throw new Error(
      `error parsing seralized config from ${configPath}: ${
        zod_val_err.fromZodError(res.error).toString()
      }`,
    );
  }
  return res.data;
}

const lockObjValidator = zod.object({
  version: zod.string(),
  platform: zod.string(), // TODO custom validator??
  moduleEntries: zod.record(zod.string(), zod.unknown()),
  config: validators.serializedConfig,
});

/**
 * The lock.json file stores the serialized config and some entries
 * from modules. It's primary purpose is as a memo store to avoid
 * re-serialization on each CLI invocation.
 */
async function readLockFile(lockFilePath: Path) {
  const rawStr = await lockFilePath.readMaybeText();
  if (!rawStr) return;
  try {
    const rawJson = JSON.parse(rawStr);
    const res = lockObjValidator.safeParse(rawJson);
    if (!res.success) {
      throw zod_val_err.fromZodError(res.error);
    }
    return res.data;
  } catch (err) {
    logger().error(
      `error parsing lockfile from ${lockFilePath}: ${err.toString()}`,
    );
    if (Deno.stderr.isTerminal() && await $.confirm("Discard lockfile?")) {
      return;
    } else {
      throw err;
    }
  }
}

const hashObjValidator = zod.object({
  version: zod.string(),
  ghjkfileHash: zod.string(),
  envVarHashes: zod.record(zod.string(), zod.string().nullish()),
  readFileHashes: zod.record(zod.string(), zod.string().nullish()),
  listedFiles: zod.string().array(),
  // TODO: track listed dirs in case a `walk`ed directory has a new entry
});

/**
 * The hash.json file stores the digests of all external accesses
 * of a ghjkfile during serialization. The primary purpose is to
 * do "cache invalidation" on ghjkfiles, re-serializing them if
 * any of the digests change.
 */
async function readHashFile(hashFilePath: Path) {
  const rawStr = await hashFilePath.readMaybeText();
  if (!rawStr) return;
  try {
    const rawJson = JSON.parse(rawStr);
    const res = hashObjValidator.safeParse(rawJson);
    if (!res.success) {
      throw zod_val_err.fromZodError(res.error);
    }
    return res.data;
  } catch (err) {
    logger().error(
      `error parsing hashfile from ${hashObjValidator}: ${err.toString()}`,
    );
    logger().warn("discarding invalid hashfile");
    return;
  }
}

async function envVarDigests(all: Record<string, string>, accessed: string[]) {
  const hashes = {} as DigestsMap;
  for (const key of accessed) {
    const val = all[key];
    if (!val) {
      // use null if the serializer accessed
      hashes[key] = null;
    } else {
      hashes[key] = await stringHashHex(val);
    }
  }
  return hashes;
}

async function fileDigests(hcx: HostCtx, readFiles: string[], cwd: Path) {
  const cwdStr = cwd.toString();
  const readFileHashes = {} as DigestsMap;
  await Promise.all(readFiles.map(async (path) => {
    const pathRef = cwd.resolve(path);
    const relativePath = pathRef
      .toString()
      .replace(cwdStr, ".");
    // FIXME: stream read into hash to improve mem usage
    const stat = await pathRef.lstat();
    if (stat) {
      const contentHash = (stat.isFile || stat.isSymlink)
        ? await fileDigestHex(hcx, pathRef)
        : null;
      readFileHashes[relativePath] = await objectHashHex({
        ...stat,
        contentHash,
      } as jsonHash.Tree);
    } else {
      readFileHashes[relativePath] = null;
    }
  }));
  return readFileHashes;
}

/**
 * Returns the hash digest of a file. Makes use of a memo
 * to dedupe work.
 */
function fileDigestHex(hcx: HostCtx, path: Path) {
  const absolute = path.resolve().toString();
  let promise = hcx.fileHashMemoStore.get(absolute);
  if (!promise) {
    promise = inner();
    hcx.fileHashMemoStore.set(absolute, promise);
  }
  return promise;
  async function inner() {
    return await bufferHashHex(
      await path.readBytes(),
    );
  }
}
