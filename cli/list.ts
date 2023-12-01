import { Command } from "../deps/cli.ts";
import { GhjkCtx } from "../modules/ports/mod.ts";

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
            plug: cx.ports.get(install.portName),
          })),
        );
      });
  }
}
