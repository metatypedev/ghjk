import { Command, fs, std_path } from "../deps/cli.ts";
import logger from "../core/logger.ts";
import { DenoWorkerPlugManifestX, GhjkCtx } from "../core/mod.ts";
import { DenoWorkerPlug } from "../core/worker.ts";
import { AVAIL_CONCURRENCY, dbg, dirs } from "./utils.ts";

async function findConfig(path: string): Promise<string | null> {
  let current = path;
  while (current !== "/") {
    const location = `${path}/ghjk.ts`;
    if (await fs.exists(location)) {
      return location;
    }
    current = std_path.dirname(current);
  }
  return null;
}

function envDirFromConfig(config: string): string {
  const { shareDir } = dirs();
  return std_path.resolve(
    shareDir,
    "envs",
    std_path.dirname(config).replaceAll("/", "."),
  );
}

async function writeLoader(envDir: string, env: Record<string, string>) {
  await Deno.mkdir(envDir, { recursive: true });
  await Deno.writeTextFile(
    `${envDir}/loader.fish`,
    Object.entries(env).map(([k, v]) =>
      `set --global --append GHJK_CLEANUP "set --global --export ${k} '$k';"; set --global --export ${k} '${v}'`
    ).join("\n"),
  );
}

export class SyncCommand extends Command {
  constructor(
    public cx: GhjkCtx,
  ) {
    super();
    this
      .description("Syncs the runtime.")
      .action(async () => {
        const config = await findConfig(Deno.cwd());
        console.log(config);
        if (!config) {
          console.log("ghjk did not find any `ghjk.ts` config.");
          return;
        }

        const envDir = envDirFromConfig(config);
        logger().debug({ envDir });

        /* for (const [name, { ty, manifest }] of cx.plugs) {
          if (ty == "denoWorker") {
            const plug = new DenoWorkerPlug(
              manifest as DenoWorkerPlugManifestX,
            );
            const versions = await plug.listAll({});
            console.log(name, { versions });
          } else {
            throw Error(
              `unsupported plugin type "${ty}": ${JSON.stringify(manifest)}`,
            );
          }
        } */
        // in the ghjk.ts the user will have declared some tools and tasks
        // we need to collect them through the `ghjk` object from main
        // (beware of multiple versions of tools libs)
        // here, only showing what should happen after as an example

        let env = {};
        for (const inst of cx.installs) {
          const regPlug = cx.plugs.get(inst.plugName);
          if (!regPlug) {
            throw Error(
              `unable to find pluign "${inst.plugName}" specified by install ${
                JSON.stringify(inst)
              }`,
            );
          }
          const { ty: plugType, manifest } = regPlug;
          let plug;
          if (plugType == "denoWorker") {
            plug = new DenoWorkerPlug(
              manifest as DenoWorkerPlugManifestX,
            );
          } else {
            throw Error(
              `unsupported plugin type "${plugType}": ${
                JSON.stringify(manifest)
              }`,
            );
          }
          const installVersion = inst.version ?? await plug.latestStable({});
          const installPath = std_path.resolve(
            envDir,
            "installs",
            plug.name,
            installVersion,
          );
          const downloadPath = std_path.resolve(
            envDir,
            "downloads",
            plug.name,
            installVersion,
          );
          await Promise.allSettled(
            [installPath, downloadPath].map((path) =>
              Deno.mkdir(path, { recursive: true })
            ),
          );
          // logger().info(`downloading ${inst.plugName}:${installVersion}`);
          // await plug.download({
          //   ASDF_INSTALL_PATH: installPath,
          //   ASDF_INSTALL_TYPE: "version",
          //   ASDF_INSTALL_VERSION: installVersion,
          //   ASDF_DOWNLOAD_PATH: downloadPath,
          // });
          logger().info(`installing ${inst.plugName}:${installVersion}`);
          await plug.install({
            ASDF_INSTALL_PATH: installPath,
            ASDF_INSTALL_TYPE: "version",
            ASDF_INSTALL_VERSION: installVersion,
            ASDF_CONCURRENCY: AVAIL_CONCURRENCY,
            ASDF_DOWNLOAD_PATH: downloadPath,
          });
          for (
            const bin of dbg(
              await plug.listBinPaths({
                ASDF_INSTALL_PATH: installPath,
                ASDF_INSTALL_TYPE: "version",
                ASDF_INSTALL_VERSION: installVersion,
              }),
            )
          ) {
            const binPath = std_path.resolve(installPath, bin);
            const binName = std_path.basename(binPath); // TODO: aliases
            const shimPath = std_path.resolve(envDir, "shims", binName);
            await Deno.remove(shimPath);
            await Deno.symlink(binPath, shimPath, { type: "file" });
          }
          env = {
            ...env,
            ...await plug.execEnv({
              ASDF_INSTALL_PATH: installPath,
              ASDF_INSTALL_TYPE: "version",
              ASDF_INSTALL_VERSION: installVersion,
            }),
          };
        }
        await writeLoader(envDir, env);
      });
  }
}
