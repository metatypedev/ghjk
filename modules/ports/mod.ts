export * from "./types.ts";

import { cliffy_cmd, zod } from "../../deps/cli.ts";
import { Json } from "../../utils/mod.ts";
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
    _lockEnt: PortsLockEnt | undefined,
  ) {
    const res = validators.portsModuleConfig.safeParse(manifest.config);
    if (!res.success) {
      throw new Error("error parsing module config", {
        cause: {
          config: manifest.config,
          zodErr: res.error,
        },
      });
    }
    const config = res.data;

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
              gcx.envDir,
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
