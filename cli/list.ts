import { Command } from "../deps/cli.ts";
import { type GhjkCtx } from "../core/mod.ts";

export class ListCommand extends Command {
  constructor(
    public cx: GhjkCtx,
  ) {
    super();
    this
      .description("")
      .action(() => {
        console.log(
          cx.installs.map((install) => ({
            install,
            plug: cx.plugs.get(install.plugName),
          })),
        );
      });
  }
}
