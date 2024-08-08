import { cliffy_cmd, deep_eql, zod, zod_val_err } from "../deps/cli.ts";
import logger from "../utils/logger.ts";
import {
  $,
  bufferHashAsync,
  Json,
  objectHash,
  Path,
  stringHash,
} from "../utils/mod.ts";
import validators, { SerializedConfig } from "./types.ts";
import * as std_modules from "../modules/std.ts";
import * as denoFile from "../files/deno/mod.ts";
import type { ModuleBase } from "../modules/mod.ts";
import { GhjkCtx } from "../modules/types.ts";
import { serializePlatform } from "../modules/ports/types/platform.ts";

export interface CliArgs {
  ghjkShareDir: string;
  ghjkfilePath?: string;
  ghjkDirPath?: string;
  reFlagSet: boolean;
  lockedFlagSet: boolean;
}

type HostCtx = {
  fileHashMemoStore: Map<string, Promise<string>>;
  curEnvVars: Record<string, string>;
  reFlagSet: boolean;
  lockedFlagSet: boolean;
};

const GHJK_VERSION = "0.2.1";

export async function cli(args: CliArgs) {
  logger().debug(`ghjk CLI`, GHJK_VERSION);
  if (args.reFlagSet && args.lockedFlagSet) {
    throw new Error("GHJK_LOCKED && GHJK_RE both set");
  }
  // items to run at end of function
  const defer = [] as (() => Promise<any>)[];

  const ghjkShareDir = $.path(args.ghjkShareDir).resolve().normalize();
  let serializedConfig: object | undefined;
  let gcx: GhjkCtx | undefined;

  if (!args.ghjkDirPath && args.ghjkfilePath) {
    args.ghjkDirPath = $.path(args.ghjkfilePath).parentOrThrow().join(".ghjk")
      .toString();
  }

  const subcmds: Record<string, any> = {};

  // most of the CLI is only avail if there's a
  // ghjkfile detected
  if (args.ghjkDirPath) {
    gcx = {
      ghjkShareDir,
      ghjkDir: $.path(args.ghjkDirPath).resolve().normalize(),
      ghjkfilePath: args.ghjkfilePath
        ? $.path(args.ghjkfilePath).resolve().normalize()
        : undefined,
      blackboard: new Map(),
    };
    const hcx: HostCtx = {
      fileHashMemoStore: new Map(),
      curEnvVars: Deno.env.toObject(),
      reFlagSet: args.reFlagSet,
      lockedFlagSet: args.lockedFlagSet,
    };
    logger().debug("context established", {
      ghjkDir: gcx?.ghjkDir.toString(),
      ghjkfilePath: gcx.ghjkfilePath?.toString(),
    });

    if (!await gcx.ghjkDir.join(".gitignore").exists()) {
      gcx.ghjkDir.join(".gitignore").writeText($.dedent`
        envs
        hash.json`);
    }

    // this returns nothing if no valid lockifle or ghjkfile
    // is found
    const commands = await commandsFromConfig(hcx, gcx);
    if (commands) {
      serializedConfig = commands.config;
      // lock entries are also generated across program usage
      // so we defer another write out until the end
      defer.push(commands.writeLockFile);

      for (
        const [cmdName, [cmd, src]] of Object.entries(commands.subCommands)
      ) {
        const conflict = subcmds[cmdName];
        if (conflict) {
          throw new Error(
            `CLI command conflict under name "${cmdName}" from host and module "${src}"`,
          );
        }
        subcmds[cmdName] = cmd;
      }
    }
  }

  const root = new cliffy_cmd.Command()
    .name("ghjk")
    .version(GHJK_VERSION)
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
              console.log(ghjkShareDir.toString());
            }),
        )
        .command(
          "ghjkdir-path",
          new cliffy_cmd.Command()
            .description("Print the path where ghjk is installed in.")
            .action(function () {
              if (!gcx) {
                throw new Error("no ghjkfile found.");
              }
              // deno-lint-ignore no-console
              console.log(gcx.ghjkDir.toString());
            }),
        )
        .command(
          "ghjkfile-path",
          new cliffy_cmd.Command()
            .description("Print the path of the ghjk.ts used")
            .action(function () {
              if (!gcx?.ghjkfilePath) {
                throw new Error("no ghjkfile found.");
              }
              // deno-lint-ignore no-console
              console.log(gcx.ghjkfilePath.toString());
            }),
        )
        .command(
          "config",
          new cliffy_cmd.Command()
            .description(
              "Print the extracted ans serialized config from the ghjkfile",
            )
            .option(
              "--json",
              `Use json format when printing config.`,
            )
            .action(function ({ json }) {
              if (!serializedConfig) {
                throw new Error("no ghjkfile found.");
              }
              // deno-lint-ignore no-console
              console.log(
                json
                  ? JSON.stringify(serializedConfig)
                  : $.inspect(serializedConfig),
              );
            }),
        ),
    );
  for (const [name, subcmd] of Object.entries(subcmds)) {
    root.command(name, subcmd);
  }
  try {
    await root.parse(Deno.args);
  } catch (err) {
    logger().error(err);
    Deno.exit(1);
  } finally {
    await Promise.all(defer.map((fn) => fn()));
  }
}

async function commandsFromConfig(hcx: HostCtx, gcx: GhjkCtx) {
  const lockFilePath = gcx.ghjkDir.join("lock.json");
  const hashFilePath = gcx.ghjkDir.join("hash.json");

  const foundLockObj = await readLockFile(lockFilePath);
  const foundHashObj = await readHashFile(hashFilePath);

  if (hcx.lockedFlagSet) {
    if (!foundLockObj) {
      throw new Error("GHJK_LOCKED set but no lockfile found");
    }
    if (!foundHashObj) {
      throw new Error("GHJK_LOCKED set but no hashfile found");
    }
  }

  const lockEntries = {} as Record<string, unknown>;

  const ghjkfileHash = await gcx.ghjkfilePath?.exists()
    ? await fileDigestHex(hcx, gcx.ghjkfilePath!)
    : undefined;

  if (!hcx.reFlagSet && foundLockObj) {
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
  }

  let configExt: SerializedConfigExt | null = null;
  let wasReSerialized = false;
  if (
    !hcx.reFlagSet &&
    foundLockObj &&
    foundHashObj &&
    (hcx.lockedFlagSet ||
      // avoid reserializing the config if
      // the ghjkfile and environment is _satisfcatorily_
      // similar. "cache validation"
      foundLockObj.version == "0" &&
        await isHashFileValid(hcx, foundLockObj, foundHashObj, ghjkfileHash))
  ) {
    configExt = {
      config: foundLockObj.config,
      envVarHashes: foundHashObj.envVarHashes,
      readFileHashes: foundHashObj.readFileHashes,
      listedFiles: foundHashObj.listedFiles,
    };
  } else if (gcx.ghjkfilePath) {
    logger().info("serializing ghjkfile", gcx.ghjkfilePath);
    configExt = await readGhjkfile(hcx, gcx.ghjkfilePath);
    wasReSerialized = true;
  } else {
    // nothing to get the commands from
    return;
  }

  const newHashObj: zod.infer<typeof hashObjValidator> = {
    version: "0",
    ghjkfileHash,
    envVarHashes: configExt.envVarHashes,
    readFileHashes: configExt.readFileHashes,
    listedFiles: configExt.listedFiles,
  };
  // command name to [cmd, source module id]
  const subCommands = {} as Record<string, [cliffy_cmd.Command, string]>;
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

  if (
    !hcx.lockedFlagSet && wasReSerialized && (
      !foundHashObj || !deep_eql(newHashObj, foundHashObj)
    )
  ) {
    await hashFilePath.writeJsonPretty(newHashObj);
  }

  // `writeLockFile` can be invoked multiple times
  // so we keep track of the last lockfile wrote
  // out to disk
  // TODO(#90): file system lock file while ghjk is running
  // to avoid multiple instances from clobbering each other
  let lastLockObj = { ...foundLockObj };
  return {
    subCommands,
    config: configExt.config,
    async writeLockFile() {
      if (hcx.lockedFlagSet) return;

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
      if (!lastLockObj || !deep_eql(newLockObj, lastLockObj)) {
        lastLockObj = { ...newLockObj };
        await lockFilePath.writeJsonPretty(newLockObj);
      }
    },
  };
}

async function isHashFileValid(
  hcx: HostCtx,
  foundLockFile: zod.infer<typeof lockObjValidator>,
  foundHashFile: zod.infer<typeof hashObjValidator>,
  ghjkfileHash?: string,
) {
  // TODO: figure out cross platform lockfiles :O
  const platformMatch = () =>
    serializePlatform(Deno.build) == foundLockFile.platform;

  const envHashesMatch = () => {
    const oldHashes = foundHashFile!.envVarHashes;
    const newHashes = envVarDigests(hcx.curEnvVars, [
      ...Object.keys(oldHashes),
    ]);
    return deep_eql(oldHashes, newHashes);
  };

  const cwd = $.path(Deno.cwd());
  const fileHashesMatch = async () => {
    const oldHashes = foundHashFile!.readFileHashes;
    const newHashes = await fileDigests(hcx, [
      ...Object.keys(oldHashes),
    ], cwd);
    return deep_eql(oldHashes, newHashes);
  };

  const fileListingsMatch = async () => {
    const oldListed = foundHashFile!.listedFiles;
    for (const path of oldListed) {
      if (!await cwd.resolve(path).exists()) {
        return false;
      }
    }
    return true;
  };
  // NOTE: these are ordered by the amount effort it takes
  // to check each
  // we only check file hash of the ghjk file if it's present
  return (ghjkfileHash ? foundHashFile.ghjkfileHash == ghjkfileHash : true) &&
    platformMatch() &&
    envHashesMatch() &&
    await fileListingsMatch() &&
    await fileHashesMatch();
}

type DigestsMap = Record<string, string | null | undefined>;

type SerializedConfigExt = Awaited<
  ReturnType<typeof readGhjkfile>
>;

async function readGhjkfile(
  hcx: HostCtx,
  configPath: Path,
) {
  switch (configPath.extname()) {
    case "":
      logger().warn("config file has no extension, assuming deno config");
    /* falls through */
    case ".ts": {
      logger().debug("serializing ts config", configPath);
      const res = await denoFile.getSerializedConfig(
        configPath.toFileUrl().href,
        hcx.curEnvVars,
      );
      const envVarHashes = envVarDigests(hcx.curEnvVars, res.accessedEnvKeys);
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
  try {
    return validators.serializedConfig.parse(raw);
  } catch (err) {
    const validationError = zod_val_err.fromError(err);
    throw new Error(
      `error parsing seralized config from ${configPath}: ${validationError.toString()}`,
      {
        cause: validationError,
      },
    );
  }
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
    return lockObjValidator.parse(rawJson);
  } catch (err) {
    const validationError = zod_val_err.fromError(err);
    logger().error(
      `error parsing lockfile from ${lockFilePath}: ${validationError.toString()}`,
    );
    if (Deno.stderr.isTerminal() && await $.confirm("Discard lockfile?")) {
      return;
    } else {
      throw validationError;
    }
  }
}

const hashObjValidator = zod.object({
  version: zod.string(),
  ghjkfileHash: zod.string().nullish(),
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
    return hashObjValidator.parse(rawJson);
  } catch (err) {
    logger().error(
      `error parsing hashfile from ${hashObjValidator}: ${
        zod_val_err.fromError(err).toString()
      }`,
    );
    logger().warn("discarding invalid hashfile");
    return;
  }
}

function envVarDigests(all: Record<string, string>, accessed: string[]) {
  const hashes = {} as DigestsMap;
  for (const key of accessed) {
    const val = all[key];
    if (!val) {
      // use null if the serializer accessed
      hashes[key] = null;
    } else {
      hashes[key] = stringHash(val);
    }
  }
  return hashes;
}

async function fileDigests(hcx: HostCtx, readFiles: string[], cwd: Path) {
  const cwdStr = cwd.toString();
  const readFileHashes = {} as DigestsMap;
  await Promise.all(readFiles.map(async (pathStr) => {
    const path = cwd.resolve(pathStr);
    const relativePath = path
      .toString()
      .replace(cwdStr, ".");
    // FIXME: stream read into hash to improve mem usage
    const stat = await path.lstat();
    if (stat) {
      const contentHash = (stat.isFile || stat.isSymlink)
        ? await fileDigestHex(hcx, path)
        : null;
      readFileHashes[relativePath] = objectHash({
        ...JSON.parse(JSON.stringify(stat)),
        contentHash,
      });
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
    return await bufferHashAsync(
      await path.readBytes(),
    );
  }
}
