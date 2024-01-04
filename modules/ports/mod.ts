export * from "./types.ts";

import { cliffy_cmd, zod } from "../../deps/cli.ts";
import { JSONValue } from "../../utils/mod.ts";
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

export class PortsModule extends ModuleBase<PortsCtx> {
  async processManifest(
    gcx: GhjkCtx,
    manifest: ModuleManifest,
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
  async loadLockEntry(
    gcx: GhjkCtx,
    manifest: ModuleManifest,
    raw: JSONValue,
  ) {
    const res = validators.portsModuleConfig.safeParse(manifest.config);
    if (!res.success) {
      throw new Error("error parsing ports module config", {
        cause: {
          config: manifest.config,
          zodErr: res.error,
        },
      });
    }
    const config = res.data;
    const lockValidator = zod.object({
      version: zod.string(),
      configResolutions: zod.record(
        zod.string(),
        validators.installConfigResolved,
      ),
    });
    const { version, configResolutions } = lockValidator.parse(raw);

    if (version != "0") {
      throw new Error(`unexepected version tag deserializing lockEntry`);
    }

    await using syncCx = await syncCtxFromGhjk(gcx, configResolutions);
    const installGraph = await buildInstallGraph(syncCx, config);
    return { config, installGraph };
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
