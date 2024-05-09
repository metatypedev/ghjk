export * from "./types.ts";

import { cliffy_cmd, zod } from "../../deps/cli.ts";
import { $, Json, unwrapParseRes } from "../../utils/mod.ts";
import logger from "../../utils/logger.ts";
import validators, {
  installSetProvisionTy,
  installSetRefProvisionTy,
} from "./types.ts";
import type { InstallSetX, PortsModuleConfigX } from "./types.ts";
import type { GhjkCtx, ModuleManifest } from "../types.ts";
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
import type {
  Provision,
  ProvisionReducer,
  WellKnownEnvRecipeX,
} from "../envs/types.ts";
import { getInstallSetStore } from "./inter.ts";

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
      installSetRefReducer(gcx, pcx) as ProvisionReducer<Provision>,
    );
    reducerStore.set(
      installSetProvisionTy,
      installSetReducer(gcx) as ProvisionReducer<Provision>,
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
            .description("TODO")
            .option("-u, --update-port <portname>", "Update specific port")
            .option("-n, --update-no-confirm", "Update all ports")
            .action(async (_opts) => {
              const {
                installedPortsVersions: _installed,
                latestPortsVersions: _latest,
              } = await getCurrentLatestVersionComparison(gcx);

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
) {
  // TODO: get InstallSetX, where: from pcx,
  // TODO: get PortMainfestX, where: ??
  // TODO: get InstallConfigLiteX, where: ??

  await using scx = await syncCtxFromGhjk(gcx);

  // TODO: remove the placeholder `envName`
  const envName = "default";
  const envDir = $.path(gcx.ghjkDir).join("envs", envName);
  const recipePath = envDir.join("recipe.json").toString();

  // read from `recipe.json` and get installSetIds
  const recipeJson = JSON.parse(await Deno.readTextFile(recipePath));
  const reducedRecipe = recipeJson as WellKnownEnvRecipeX;

  const db = scx.db.val;

  const installedPortsVersion = new Map<string, string>();
  const latestPortsVersion = new Map<string, string>();
  // get the current/installed version for the ports
  for (
    const { wellKnownProvision: _, installSetIdProvision } of reducedRecipe
      .provides
  ) {
    if (!installSetIdProvision) {
      continue;
    }
    const setId = installSetIdProvision?.id;
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

    // TODO: resolve
    let set: InstallSetX;

    const resolvedResolutionDeps = [] as [string, string][];
    for (const dep of manifest.resolutionDeps ?? []) {
      const { manifest: depManifest, config: depConf } = getDepConfig(
        set!,
        manifest,
        config,
        dep,
      );

      // TODO: avoid reinstall, infact just do a resolve
      const depInstId = await resolveAndInstall(
        scx,
        set!,
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

    // finally resolve the version
    let version;
    // TODO: fuzzy matching
    const port = getPortImpl(manifest);
    const listAllArgs = {
      depArts: resolutionDepArts,
      config,
      manifest,
    };
    if (config.version) {
      const allVersions = await port.listAll(listAllArgs);
      // TODO: fuzzy matching
      const match = allVersions.find((version) =>
        version.match(new RegExp(`^v?${config.version}$`))
      );
      if (!match) {
        throw new Error(`error resolving verison: not found`, {
          cause: { config, manifest },
        });
      }
      version = match;
      installedPortsVersion.set(setId, version);
    } else {
      throw new Error("Port Version not found in the Config");
    }

    // get the latest version of the port
    const latestStable = await port.latestStable(listAllArgs);
    latestPortsVersion.set(setId, latestStable);

    await $.removeIfExists(depShimsRootPath);
  }

  return {
    installedPortsVersions: installedPortsVersion,
    latestPortsVersions: latestPortsVersion,
  };
}
