export * from "./types.ts";

import { cliffy_cmd, zod } from "../../deps/cli.ts";
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
  InstallProvision,
  InstallSetX,
  PortsModuleConfigX,
} from "./types.ts";
import {
  type GhjkCtx,
  type ModuleManifest,
  portsCtxBlackboardKey,
} from "../types.ts";
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
import { getInstallSetStore } from "./inter.ts";
import { getEnvsCtx } from "../utils.ts";

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
        bb,
      }, "error parsing module config");
    }

    const hashedModConf = unwrapParseCurry(
      validators.portsModuleConfigHashed.safeParse(manifest.config),
    );
    const pcx: PortsCtx = {
      config: {
        sets: {},
      },
    };

    const setStore = getInstallSetStore(gcx);
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
          bb[hashedSet.allowedDeps],
        ),
      );
      const allowedDeps = Object.fromEntries(
        Object.entries(allowedDepSetHashed).map((
          [key, hash],
        ) => [
          key,
          unwrapParseCurry(validators.allowedPortDep.safeParse(bb[hash])),
        ]),
      );
      const set: InstallSetX = {
        installs,
        allowedDeps,
      };
      pcx.config.sets[id] = set;
      setStore.set(id, set);
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

    gcx.blackboard.set(portsCtxBlackboardKey, pcx);
    // console.log($.inspect(pcx.config.sets));
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
            .description("TODO")
            .option("-u, --update-port <portname>", "Update specific port")
            .option("-n, --update-no-confirm", "Update all ports")
            .action(async (_opts) => {
              const envsCtx = getEnvsCtx(gcx);
              const envName = envsCtx.activeEnv;

              let allowedDeps = {};
              const installSets = pcx.config.sets;

              for (const [_id, instSet] of Object.entries(installSets)) {
                const set = unwrapParseRes(
                  validators.installSet.safeParse(instSet),
                  {
                    envName,
                    instSet,
                  },
                  "error parsing install set for the current env",
                );
                allowedDeps = set.allowedDeps;
              }

              const {
                installedPortsVersions: _installed,
                latestPortsVersions: _latest,
              } = await getCurrentLatestVersionComparison(
                gcx,
                envName,
                allowedDeps,
              );

              // update selectively and the whole ports

              // display the versions in table
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

async function getCurrentLatestVersionComparison(
  gcx: GhjkCtx,
  envName: string,
  allowedDeps: Record<string, AllowedPortDep>,
) {
  // TODO: get InstallSetX, where: from pcx,
  // TODO: get PortMainfestX, where: ??
  // TODO: get InstallConfigLiteX, where: ??

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
  // get the current/installed version for the ports
  for (
    const installProv of installProvisions
  ) {
    const setId = installProv.instId;
    const installSet = await db.get(setId);

    if (!installSet) {
      throw new Error("InstallSetId not found in InstallsDb", {
        cause: {
          setId,
        },
      });
    }

    const manifest = installSet.manifest;
    const config = installSet.conf;

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
    installedPortsVersions.set(setId, currentVersion);

    // get the latest version of the port
    const latestStable = await port.latestStable(listAllArgs);
    latestPortsVersions.set(setId, latestStable);

    await $.removeIfExists(depShimsRootPath);
  }

  return {
    installedPortsVersions: installedPortsVersions,
    latestPortsVersions: latestPortsVersions,
  };
}
