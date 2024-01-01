export * from "./types.ts";

import { cliffy_cmd } from "../../deps/cli.ts";
import { JSONValue } from "../../utils/mod.ts";
import logger from "../../utils/logger.ts";
import validators from "./types.ts";
import type { PortsModuleConfigX } from "./types.ts";
import type { GhjkCtx, ModuleManifest } from "../types.ts";
import { ModuleBase } from "../mod.ts";
import {
  buildInstallGraph,
  installFromGraphAndShimEnv,
  InstallGraph,
  syncCtxFromGhjk,
} from "./sync.ts";

export type PortsModuleManifest = {
  config: PortsModuleConfigX;
  graph: InstallGraph;
};

export class PortsModule extends ModuleBase<PortsModuleManifest> {
  async processManifest(
    ctx: GhjkCtx,
    manifest: ModuleManifest,
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
    await using syncCx = await syncCtxFromGhjk(ctx);
    const graph = await buildInstallGraph(syncCx, res.data);
    return {
      config: res.data,
      graph,
    };
  }
  command(
    ctx: GhjkCtx,
    manifest: PortsModuleManifest,
  ) {
    return new cliffy_cmd.Command()
      // .alias("port")
      .action(function () {
        this.showHelp();
      })
      .description("Ports module, install programs into your env.")
      .command(
        "sync",
        new cliffy_cmd.Command().description("Syncs the environment.")
          .action(async () => {
            logger().debug("syncing ports");
            await using syncCx = await syncCtxFromGhjk(ctx);
            void await installFromGraphAndShimEnv(
              syncCx,
              ctx.envDir,
              manifest.graph,
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
    _ctx: GhjkCtx,
    raw: JSONValue,
  ) {
    if (!raw || typeof raw != "object" || Array.isArray(raw)) {
      throw new Error(`unexepected value deserializing lockEntry`);
    }
    const { version, ...rest } = raw;
    if (version != "0") {
      throw new Error(`unexepected version tag deserializing lockEntry`);
    }
    // FIXME: zod this up
    return rest as PortsModuleManifest;
  }
  genLockEntry(
    _ctx: GhjkCtx,
    manifest: PortsModuleManifest,
  ) {
    return {
      version: "0",
      ...JSON.parse(JSON.stringify(manifest)),
    };
  }
}
