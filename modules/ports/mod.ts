export * from "./types.ts";

import { cliffy_cmd } from "../../deps/cli.ts";
import { $, JSONValue } from "../../utils/mod.ts";
import validators from "./types.ts";
import type { PortsModuleConfigX } from "./types.ts";
import type { GhjkCtx, ModuleManifest } from "../types.ts";
import { ModuleBase } from "../mod.ts";
import { buildInstallGraph, installAndShimEnv, InstallGraph } from "./sync.ts";
import { installsDbKv } from "./db.ts";

export type PortsModuleManifest = {
  config: PortsModuleConfigX;
  graph: InstallGraph;
};

export class PortsModule extends ModuleBase<PortsModuleManifest> {
  async processManifest(
    _ctx: GhjkCtx,
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
    return {
      config: res.data,
      graph: await buildInstallGraph(res.data),
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
            const portsDir = await $.path(ctx.ghjkDir).resolve("ports")
              .ensureDir();
            using db = await installsDbKv(
              portsDir.resolve("installs.db").toString(),
            );
            void await installAndShimEnv(
              portsDir.toString(),
              ctx.envDir,
              db,
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
