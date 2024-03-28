export * from "./types.ts";

import { cliffy_cmd, zod } from "../../deps/cli.ts";
import { $, Json } from "../../utils/mod.ts";
import logger from "../../utils/logger.ts";
import validators from "./types.ts";
import type { PortsModuleConfigX } from "./types.ts";
import type { GhjkCtx, ModuleManifest } from "../types.ts";
import { ModuleBase } from "../mod.ts";
import {
  buildInstallGraph,
  getResolutionMemo,
  installFromGraphAndShimEnv,
  type InstallGraph,
  syncCtxFromGhjk,
} from "./sync.ts";
import { Blackboard } from "../../host/types.ts";

type PortsCtx = {
  config: PortsModuleConfigX;
  installGraph: InstallGraph;
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
    function unwrapParseRes<In, Out>(res: zod.SafeParseReturnType<In, Out>) {
      if (!res.success) {
        throw new Error("error parsing module config", {
          cause: {
            zodErr: res.error,
            id: manifest.id,
            config: manifest.config,
            bb,
          },
        });
      }
      return res.data;
    }
    const hashed = unwrapParseRes(
      validators.portsModuleConfigHashed.safeParse(manifest.config),
    );
    const config: PortsModuleConfigX = {
      installs: hashed.installs.map((hash) =>
        unwrapParseRes(validators.installConfigFat.safeParse(bb[hash]))
      ),
      allowedDeps: Object.fromEntries(
        Object.entries(hashed.allowedDeps).map((
          [key, value],
        ) => [
          key,
          unwrapParseRes(validators.allowedPortDep.safeParse(bb[value])),
        ]),
      ),
    };

    await using syncCx = await syncCtxFromGhjk(gcx);
    const installGraph = await buildInstallGraph(syncCx, config);
    return { config, installGraph };
  }

  command(
    gcx: GhjkCtx,
    pcx: PortsCtx,
  ) {
    return new cliffy_cmd.Command()
      .alias("p")
      .action(function () {
        this.showHelp();
      })
      .description("Ports module, install programs into your env.")
      .command(
        "sync",
        new cliffy_cmd.Command().description("Syncs the environment.")
          .action(async () => {
            logger().debug("syncing ports");
            await using syncCx = await syncCtxFromGhjk(gcx);
            void await installFromGraphAndShimEnv(
              syncCx,
              $.path(gcx.ghjkDir).join("envs", "default").toString(),
              pcx.installGraph,
            );
          }),
      )
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
