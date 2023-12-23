export * from "./types.ts";

import { cliffy_cmd } from "../../deps/cli.ts";
import { $ } from "../../utils/mod.ts";
import validators from "./types.ts";
import type { PortsModuleConfig } from "./types.ts";
import type { GhjkCtx, ModuleManifest } from "../types.ts";
import { ModuleBase } from "../mod.ts";
import { sync } from "./sync.ts";
import { installsDbKv } from "./db.ts";

export class PortsModule extends ModuleBase {
  public static init(
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
    return new PortsModule(ctx, res.data);
  }
  constructor(
    private ctx: GhjkCtx,
    private config: PortsModuleConfig,
  ) {
    super();
  }
  command() {
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
            const portsDir = await $.path(this.ctx.ghjkDir).resolve("ports")
              .ensureDir();
            using db = await installsDbKv(
              portsDir.resolve("installs.db").toString(),
            );
            return await sync(
              portsDir.toString(),
              this.ctx.envDir,
              this.config,
              db,
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
}
