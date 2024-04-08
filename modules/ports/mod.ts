export * from "./types.ts";

import { cliffy_cmd, zod } from "../../deps/cli.ts";
import { Json, unwrapParseRes } from "../../utils/mod.ts";
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
  getResolutionMemo,
  type InstallGraph,
  syncCtxFromGhjk,
} from "./sync.ts"; // TODO: rename to install.ts
import type { Blackboard } from "../../host/types.ts";
import { getProvisionReducerStore } from "../envs/reducer.ts";
import { installSetReducer, installSetRefReducer } from "./reducers.ts";
import type { Provision, ProvisionReducer } from "../envs/types.ts";
import { getInstallSetMetaStore, installGraphToSetMeta } from "./inter.ts";

export type PortsCtx = {
  config: PortsModuleConfigX;
  /*
   * A map from a setId found in the `PortsModuleConfigX` to the `InstallGraph`.
   */
  installGraphs: Map<string, InstallGraph>;
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
  async processManifest(
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
      installGraphs: new Map(),
    };
    // pre-process the install sets found in the config
    {
      // syncCx contains a reference counted db connection
      // somewhere deep in there
      // so we need to use `using`
      await using syncCx = await syncCtxFromGhjk(gcx);
      const installMetaStore = getInstallSetMetaStore(gcx);
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
        const installGraph = await buildInstallGraph(syncCx, set);
        installMetaStore.set(id, installGraphToSetMeta(installGraph));
        pcx.config.sets[id] = set;
        pcx.installGraphs.set(id, installGraph);
      }
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

  command(
    _gcx: GhjkCtx,
    _pcx: PortsCtx,
  ) {
    return new cliffy_cmd.Command()
      .alias("p")
      .action(function () {
        this.showHelp();
      })
      .description("Ports module, install programs into your env.")
      .command(
        "outdated",
        new cliffy_cmd.Command()
          .description("TODO")
          .action(function () {
            throw new Error("TODO");
          }),
      )
      .command(
        "cleanup",
        new cliffy_cmd.Command()
          .description("TODO")
          .action(function () {
            throw new Error("TODO");
          }),
      );
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
