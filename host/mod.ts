import { cliffy_cmd, equal, jsonHash, zod } from "../deps/cli.ts";
import logger, { isColorfulTty } from "../utils/logger.ts";

import {
  $,
  bufferHashHex,
  dbg,
  envDirFromConfig,
  Json,
  objectHashHex,
  PathRef,
  stringHashHex,
} from "../utils/mod.ts";
import validators from "./types.ts";
import * as std_modules from "../modules/std.ts";
import * as deno from "./deno.ts";
import type { ModuleBase } from "../modules/mod.ts";
import { GhjkCtx } from "../modules/types.ts";
import portValidators from "../modules/ports/types.ts";

export interface CliArgs {
  ghjkDir: string;
  configPath: string;
}

type HostCtx = {
  fileHashMemoStore: Map<string, Promise<string>>;
};

export async function cli(args: CliArgs) {
  const configPath = $.path(args.configPath).resolve().normalize().toString();
  const ghjkDir = $.path(args.ghjkDir).resolve().normalize().toString();
  const envDir = envDirFromConfig(ghjkDir, configPath);

  logger().debug({ configPath, envDir });

  const gcx = { ghjkDir, configPath, envDir, state: new Map() };
  const hcx = { fileHashMemoStore: new Map() };

  const { subCommands, serializedConfig } = await readConfig(gcx, hcx);

  let cmd: cliffy_cmd.Command<any, any, any, any> = new cliffy_cmd.Command()
    .name("ghjk")
    .version("0.1.1") // FIXME: better way to resolve version
    .description("Programmable runtime manager.")
    .action(function () {
      this.showHelp();
    })
    .command(
      "print",
      new cliffy_cmd.Command()
        .description("Emit different discovored and built values to stdout.")
        .action(function () {
          this.showHelp();
        })
        .command(
          "ghjk-dir-path",
          new cliffy_cmd.Command()
            .description("Print the path where ghjk is installed in.")
            .action(function () {
              console.log(ghjkDir);
            }),
        )
        .command(
          "config-path",
          new cliffy_cmd.Command()
            .description("Print the path of the ghjk.ts used")
            .action(function () {
              console.log(configPath);
            }),
        )
        .command(
          "config",
          new cliffy_cmd.Command()
            .description(
              "Print the extracted ans serialized config from the ghjk.ts file",
            )
            .action(function () {
              console.log(Deno.inspect(serializedConfig, {
                depth: 10,
                colors: isColorfulTty(),
              }));
            }),
        )
        .command(
          "env-dir-path",
          new cliffy_cmd.Command()
            .description(
              "Print the directory the current config's env is housed in.",
            )
            .action(function () {
              console.log(envDir);
            }),
        ),
    )
    .command(
      "deno",
      new cliffy_cmd.Command()
        .description("Access the deno cli used by ghjk.")
        .useRawArgs()
        .action(async function (_, ...args) {
          logger().debug(args);
          await $.raw`${Deno.execPath()} ${args}`
            .env("DENO_EXEC_PATH", Deno.execPath());
        }),
    );

  for (const [name, subcmd] of Object.entries(subCommands)) {
    cmd = cmd.command(name, subcmd);
  }
  await cmd
    .command("completions", new cliffy_cmd.CompletionsCommand())
    .parse(Deno.args);
}

async function readConfig(gcx: GhjkCtx, hcx: HostCtx) {
  const configPath = $.path(gcx.configPath);
  const configFileStat = await configPath.stat();
  // FIXME: subset of ghjk commands should be functional
  // even if config file not found
  if (!configFileStat) {
    throw new Error("unable to locate config file", {
      cause: gcx,
    });
  }
  const lockFilePath = configPath
    .parentOrThrow()
    .join("ghjk.lock");
  const hashFilePath = $.path(gcx.ghjkDir).join("hashes").join(
    await stringHashHex(configPath.toString()),
  );

  const subCommands = {} as Record<string, cliffy_cmd.Command>;
  const lockEntries = {} as Record<string, unknown>;

  const curEnvVars = Deno.env.toObject();

  const foundLockObj = await readLockFile(lockFilePath);
  const foundHashObj = await readHashFile(hashFilePath);

  const ghjkfileHash = await fileHashHex(hcx, configPath);

  let serializedConfig;
  let envVarHashes;
  let readFileHashes;
  let listedFiles;
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
      foundLockObj.platform[0] == Deno.build.os &&
      foundLockObj.platform[1] == Deno.build.arch;

    const envHashesMatch = async () => {
      const oldHashes = foundHashObj!.envVarHashes;
      const newHashes = await hashEnvVars(curEnvVars, [
        ...Object.keys(oldHashes),
      ]);
      return equal.equal(oldHashes, newHashes);
    };

    const cwd = $.path(Deno.cwd());
    const fileHashesMatch = async () => {
      const oldHashes = foundHashObj!.readFileHashes;
      const newHashes = await hashFiles(hcx, [
        ...Object.keys(oldHashes),
      ], cwd);
      return equal.equal(oldHashes, newHashes);
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
    // similar
    if (
      foundHashObj &&
      foundHashObj.ghjkfileHash == ghjkfileHash &&
      platformMatch() &&
      await fileHashesMatch() &&
      await fileListingsMatch() &&
      await envHashesMatch()
    ) {
      serializedConfig = foundLockObj.config;
      envVarHashes = foundHashObj.envVarHashes;
      readFileHashes = foundHashObj.readFileHashes;
      listedFiles = foundHashObj.listedFiles;
    }
  }

  // if one is null, all are null but typescript
  // doesn't know better so check both
  if (!serializedConfig || !envVarHashes || !readFileHashes || !listedFiles) {
    logger().info("serializing ghjkfile", configPath);
    ({ config: serializedConfig, envVarHashes, listedFiles, readFileHashes } =
      await readAndSerializeConfig(
        hcx,
        configPath,
        curEnvVars,
      ));
  }

  const newLockObj: zod.infer<typeof lockObjValidator> = {
    version: "0",
    platform: [Deno.build.os, Deno.build.arch],
    moduleEntries: {} as Record<string, unknown>,
    config: serializedConfig,
  };
  const newHashObj: zod.infer<typeof hashObjValidator> = {
    version: "0",
    ghjkfileHash,
    envVarHashes,
    readFileHashes,
    listedFiles,
  };
  const instances = [];
  for (const man of serializedConfig.modules) {
    const mod = std_modules.map[man.id];
    if (!mod) {
      throw new Error(`unrecognized module specified by ghjk.ts: ${man.id}`);
    }
    const instance: ModuleBase<unknown, unknown> = new mod.ctor();
    const pMan = await instance.processManifest(gcx, man, lockEntries[man.id]);
    instances.push([man.id, instance, pMan] as const);
    subCommands[man.id] = instance.command(gcx, pMan);
  }
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
  if (!foundLockObj || !equal.equal(newLockObj, foundLockObj)) {
    await lockFilePath.writeText(
      JSON.stringify(newLockObj, undefined, 2),
    );
  }
  if (!foundHashObj || !equal.equal(newHashObj, foundHashObj)) {
    await hashFilePath.writeText(
      JSON.stringify(newHashObj, undefined, 2),
    );
  }
  return { subCommands, serializedConfig };
}

async function readAndSerializeConfig(
  hcx: HostCtx,
  configPath: PathRef,
  envVars: Record<string, string>,
) {
  let raw;
  let envVarHashes;
  let readFileHashes;
  let listedFiles;
  switch (configPath.extname()) {
    case "":
      logger().warning("config file has no extension, assuming deno config");
      /* falls through */
    case ".ts": {
      const res = await deno.getSerializedConfig(
        configPath.toFileUrl().href,
        envVars,
      );
      raw = res.config;
      envVarHashes = await hashEnvVars(envVars, res.accessedEnvKeys);
      const cwd = $.path(Deno.cwd());
      const cwdStr = cwd.toString();
      listedFiles = res.listedFiles
        .map((path) => cwd.resolve(path).toString().replace(cwdStr, "."));
      // FIXME: this breaks if the version of the file the config reads
      // has changed by this point
      // consider reading mtime of files when read by the serializer and comparing
      // them before hashing to make sure we get the same file
      // not sure what to do if it has changed though, re-serialize?
      readFileHashes = await hashFiles(hcx, res.readFiles, cwd);
      break;
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
  const res = validators.serializedConfig.safeParse(raw);
  if (!res.success) {
    logger().error("zod error", res.error);
    logger().error("serializedConf", raw);
    throw new Error(`error parsing seralized config from ${configPath}`);
  }
  const config = res.data;
  return { config, envVarHashes, readFileHashes, listedFiles };
}

const lockObjValidator = zod.object({
  version: zod.string(),
  platform: zod.tuple([portValidators.osEnum, portValidators.archEnum]),
  moduleEntries: zod.record(zod.string(), zod.unknown()),
  config: validators.serializedConfig,
});

async function readLockFile(lockFilePath: PathRef) {
  const raw = await lockFilePath.readMaybeJson();
  if (!raw) return;
  const res = lockObjValidator.safeParse(raw);
  if (!res.success) {
    throw new Error(`error parsing lockfile from ${lockFilePath}`, {
      cause: res.error,
    });
  }
  return res.data;
}

const hashObjValidator = zod.object({
  version: zod.string(),
  ghjkfileHash: zod.string(),
  envVarHashes: zod.record(zod.string(), zod.string().nullish()),
  readFileHashes: zod.record(zod.string(), zod.string().nullish()),
  listedFiles: zod.string().array(),
  // TODO: track listed dirs in case a `walk`ed directory has a new entry
});

async function readHashFile(hashFilePath: PathRef) {
  const raw = await hashFilePath.readMaybeJson();
  if (!raw) return;
  const res = hashObjValidator.safeParse(raw);
  if (!res.success) {
    throw new Error(`error parsing hashfile from ${hashObjValidator}`, {
      cause: res.error,
    });
  }
  return res.data;
}

async function hashEnvVars(all: Record<string, string>, accessed: string[]) {
  const hashes = {} as Record<string, string | null>;
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

async function hashFiles(hcx: HostCtx, readFiles: string[], cwd: PathRef) {
  dbg({ readFiles });
  const cwdStr = cwd.toString();
  const readFileHashes = {} as Record<string, string | null>;
  for (const path of readFiles) {
    const pathRef = cwd.resolve(path);
    const relativePath = pathRef
      .toString()
      .replace(cwdStr, ".");
    // FIXME: stream read into hash to improve mem usage
    const stat = await pathRef.lstat();
    if (stat) {
      const contentHash = (stat.isFile || stat.isSymlink)
        ? await fileHashHex(hcx, pathRef)
        : null;
      readFileHashes[relativePath] = await objectHashHex({
        ...stat,
        contentHash,
      } as jsonHash.Tree);
    } else {
      readFileHashes[relativePath] = null;
    }
  }
  return readFileHashes;
}

function fileHashHex(hcx: HostCtx, path: PathRef) {
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
