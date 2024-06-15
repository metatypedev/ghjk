export * from "./types.ts";

import { cliffy_cmd, Table, zod } from "../../deps/cli.ts";
import { $, Json, unwrapParseRes } from "../../utils/mod.ts";
import logger from "../../utils/logger.ts";
import validators, {
  installProvisionTy,
  installSetProvisionTy,
  installSetRefProvisionTy,
} from "./types.ts";
import envsValidators from "../envs/types.ts";
import type {
  AllowedPortDep,
  InstallConfigResolved,
  InstallProvision,
  InstallSetRefProvision,
  InstallSetX,
  PortsModuleConfigX,
} from "./types.ts";
import { type GhjkCtx, type ModuleManifest } from "../types.ts";
import { ModuleBase } from "../mod.ts";
import {
  buildInstallGraph,
  getDepConfig,
  getPortImpl,
  getResolutionMemo,
  getShimmedDepArts,
  resolveAndInstall,
  syncCtxFromGhjk,
} from "./sync.ts"; // TODO: rename to install.ts
import type { Blackboard } from "../../host/types.ts";
import { getProvisionReducerStore } from "../envs/reducer.ts";
import { installSetReducer, installSetRefReducer } from "./reducers.ts";
import type { Provision, ProvisionReducer } from "../envs/types.ts";
import { getPortsCtx } from "./inter.ts";
import { updateInstall } from "./utils.ts";
import { getEnvsCtx } from "../envs/inter.ts";

export type PortsCtx = {
  config: PortsModuleConfigX;
};

const lockValidator = zod.object({
  version: zod.string(),
  configResolutions: zod.record(
    zod.string(),
    validators.installConfigResolved,
  ),
});
type PortsLockEnt = zod.infer<typeof lockValidator>;

export class PortsModule extends ModuleBase<PortsCtx, PortsLockEnt> {
  processManifest(
    gcx: GhjkCtx,
    manifest: ModuleManifest,
    bb: Blackboard,
    _lockEnt: PortsLockEnt | undefined,
  ) {
    function unwrapParseCurry<I, O>(res: zod.SafeParseReturnType<I, O>) {
      return unwrapParseRes<I, O>(res, {
        id: manifest.id,
        config: manifest.config,
      }, "error parsing module config");
    }

    const hashedModConf = unwrapParseCurry(
      validators.portsModuleConfigHashed.safeParse(manifest.config),
    );

    const pcx: PortsCtx = getPortsCtx(gcx);

    // pre-process the install sets found in the config
    for (const [id, hashedSet] of Object.entries(hashedModConf.sets)) {
      // install sets in the config use hash references to dedupe InstallConfigs,
      // AllowedDepSets and AllowedDeps
      // reify the references from the blackboard before continuing
      const installs = hashedSet.installs.map((hash) =>
        unwrapParseCurry(validators.installConfigFat.safeParse(bb[hash]))
      );
      const allowedDepSetHashed = unwrapParseCurry(
        validators.allowDepSetHashed.safeParse(
          bb[hashedSet.allowedBuildDeps],
        ),
      );
      const allowedBuildDeps = Object.fromEntries(
        Object.entries(allowedDepSetHashed).map((
          [key, hash],
        ) => [
          key,
          unwrapParseCurry(validators.allowedPortDep.safeParse(bb[hash])),
        ]),
      );
      const set: InstallSetX = {
        installs,
        allowedBuildDeps,
      };
      pcx.config.sets[id] = set;
    }

    // register envrionment reducers for any
    // environemnts making use of install sets
    const reducerStore = getProvisionReducerStore(gcx);
    reducerStore.set(
      installSetRefProvisionTy,
      installSetRefReducer(gcx, pcx) as ProvisionReducer<Provision, Provision>,
    );
    reducerStore.set(
      installSetProvisionTy,
      installSetReducer(gcx) as ProvisionReducer<Provision, Provision>,
    );

    return pcx;
  }

  commands(
    gcx: GhjkCtx,
    pcx: PortsCtx,
  ) {
    return {
      ports: new cliffy_cmd.Command()
        .alias("p")
        .action(function () {
          this.showHelp();
        })
        .description("Ports module, install programs into your env.")
        .command(
          "resolve",
          new cliffy_cmd.Command()
            .description(`Resolve all installs declared in config.

- Useful to pre-resolve and add all install configs to the lockfile.`)
            .action(async function () {
              // scx contains a reference counted db connection
              // somewhere deep in there
              // so we need to use `using`
              await using scx = await syncCtxFromGhjk(gcx);
              for (const [_id, set] of Object.entries(pcx.config.sets)) {
                void await buildInstallGraph(scx, set);
              }
            }),
        )
        .command(
          "outdated",
          new cliffy_cmd.Command()
            .description("Show a version table for installs")
            .option(
              "-u, --update-install <installName>",
              "Update specific install",
            )
            .option("-n, --update-all", "Update all installs")
            .action(async (opts) => {
              const envsCtx = getEnvsCtx(gcx);
              const envName = envsCtx.activeEnv;

              const installSets = pcx.config.sets;

              let currInstallSetId;
              {
                const activeEnvName = envsCtx.activeEnv;
                const activeEnv = envsCtx.config
                  .envs[
                    envsCtx.config.envsNamed[activeEnvName] ?? activeEnvName
                  ];
                if (!activeEnv) {
                  throw new Error(
                    `No env found under given name "${activeEnvName}"`,
                  );
                }

                const instSetRef = activeEnv.provides.filter((prov) =>
                  prov.ty === installSetRefProvisionTy
                )[0] as InstallSetRefProvision;

                currInstallSetId = instSetRef.setId;
              }
              const currInstallSet = installSets[currInstallSetId];
              const allowedDeps = currInstallSet.allowedBuildDeps;

              const rows = [];
              const {
                installedPortsVersions: installed,
                latestPortsVersions: latest,
                installConfigs,
              } = await getOldNewVersionComparison(
                gcx,
                envName,
                allowedDeps,
              );
              for (let [installId, installedVersion] of installed.entries()) {
                let latestVersion = latest.get(installId);
                if (!latestVersion) {
                  throw new Error(
                    `Couldn't find the latest version for install id: ${installId}`,
                  );
                }

                if (latestVersion[0] === "v") {
                  latestVersion = latestVersion.slice(1);
                }
                if (installedVersion[0] === "v") {
                  installedVersion = installedVersion.slice(1);
                }

                const config = installConfigs.get(installId);

                if (!config) {
                  throw new Error(
                    `Config not found for install id: ${installId}`,
                  );
                }

                if (config["specifiedVersion"]) {
                  latestVersion = "=" + latestVersion;
                }

                const presentableConfig = { ...config };
                ["buildDepConfigs", "version", "specifiedVersion"].map(
                  (key) => {
                    delete presentableConfig[key];
                  },
                );
                const row = [
                  $.inspect(presentableConfig),
                  installedVersion,
                  latestVersion,
                ];
                rows.push(row);
              }

              if (opts.updateInstall) {
                const installName = opts.updateInstall;
                // TODO: convert from install name to install id, after port module refactor
                let installId!: string;
                const newVersion = latest.get(installId);
                if (!newVersion) {
                  logger().info(
                    `Error while fetching the latest version for: ${installName}`,
                  );
                  return;
                }
                await updateInstall(gcx, installId, newVersion, allowedDeps);
                return;
              }

              if (opts.updateAll) {
                for (const [installId, newVersion] of latest.entries()) {
                  await updateInstall(gcx, installId, newVersion, allowedDeps);
                }
                return;
              }

              const _versionTable = new Table()
                .header(["Install Config", "Old Version", "New Version"])
                .body(rows)
                .border()
                .padding(1)
                .indent(2)
                .maxColWidth(30)
                .render();
            }),
        )
        .command(
          "cleanup",
          new cliffy_cmd.Command()
            .description("TODO")
            .action(function () {
              throw new Error("TODO");
            }),
        ),
    };
  }
  loadLockEntry(
    gcx: GhjkCtx,
    raw: Json,
  ) {
    const entry = lockValidator.parse(raw);

    if (entry.version != "0") {
      throw new Error(`unexepected version tag deserializing lockEntry`);
    }
    const memoStore = getResolutionMemo(gcx);
    for (const [hash, config] of Object.entries(entry.configResolutions)) {
      logger().debug("restoring resolution from lockfile", config);
      memoStore.set(hash, Promise.resolve(config));
    }

    return entry;
  }

  async genLockEntry(
    gcx: GhjkCtx,
    _pcx: PortsCtx,
  ) {
    const memo = getResolutionMemo(gcx);
    const configResolutions = Object.fromEntries(
      await Array.fromAsync(
        [...memo.entries()].map(async ([key, prom]) => [key, await prom]),
      ),
    );
    return {
      version: "0",
      configResolutions: JSON.parse(JSON.stringify(configResolutions)),
    };
  }
}

async function getOldNewVersionComparison(
  gcx: GhjkCtx,
  envName: string,
  allowedDeps: Record<string, AllowedPortDep>,
) {
  await using scx = await syncCtxFromGhjk(gcx);

  const envDir = $.path(gcx.ghjkDir).join("envs", envName);
  const recipePath = envDir.join("recipe.json").toString();

  // read from `recipe.json` and get installSetIds
  const recipeJson = JSON.parse(await Deno.readTextFile(recipePath));
  const reducedRecipe = unwrapParseRes(
    envsValidators.envRecipe.safeParse(recipeJson),
    {
      envName,
      recipePath,
    },
    "error parsing recipe.json",
  );

  const installProvisions = reducedRecipe.provides.filter((prov) =>
    prov.ty === installProvisionTy
  ) as InstallProvision[];

  const db = scx.db.val;

  const installedPortsVersions = new Map<string, string>();
  const latestPortsVersions = new Map<string, string>();
  const installConfigs = new Map<string, InstallConfigResolved>();

  // get the current/installed version for the ports
  for (
    const installProv of installProvisions
  ) {
    const installId = installProv.instId;
    const install = await db.get(installId);

    if (!install) {
      throw new Error("InstallId not found in InstallsDb", {
        cause: {
          installId,
        },
      });
    }

    const manifest = install.manifest;
    const config = install.conf;

    const resolvedResolutionDeps = [] as [string, string][];
    for (const dep of manifest.resolutionDeps ?? []) {
      const { manifest: depManifest, config: depConf } = getDepConfig(
        allowedDeps,
        manifest,
        config,
        dep,
      );

      // TODO: avoid reinstall, infact just do a resolve
      const depInstId = await resolveAndInstall(
        scx,
        allowedDeps,
        depManifest,
        depConf,
      );
      resolvedResolutionDeps.push([depInstId.installId, depManifest.name]);
    }

    const depShimsRootPath = await Deno.makeTempDir({
      dir: scx.tmpPath,
      prefix: `shims_resDeps_${manifest.name}_`,
    });
    const resolutionDepArts = await getShimmedDepArts(
      scx,
      depShimsRootPath,
      resolvedResolutionDeps,
    );

    const port = getPortImpl(manifest);
    const listAllArgs = {
      depArts: resolutionDepArts,
      config,
      manifest,
    };

    // get the current Version
    const currentVersion = config.version;
    installedPortsVersions.set(installId, currentVersion);

    // get the latest version of the port
    const latestStable = await port.latestStable(listAllArgs);
    latestPortsVersions.set(installId, latestStable);

    installConfigs.set(installId, config);

    await $.removeIfExists(depShimsRootPath);
  }

  return {
    installedPortsVersions: installedPortsVersions,
    latestPortsVersions: latestPortsVersions,
    installConfigs: installConfigs,
  };
}
