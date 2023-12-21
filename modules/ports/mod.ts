export * from "./types.ts";

import { cliffy_cmd } from "../../deps/cli.ts";

import { type PortsModuleConfig } from "./types.ts";
import { type GhjkCtx } from "../types.ts";
import { ModuleBase } from "../mod.ts";
import { sync } from "./sync.ts";

export class PortsModule extends ModuleBase {
  constructor(
    public ctx: GhjkCtx,
    public config: PortsModuleConfig,
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
          .action(() => sync(this.ctx.ghjkDir, this.ctx.envDir, this.config)),
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
      )
      .command("completions", new cliffy_cmd.CompletionsCommand());
  }
}
