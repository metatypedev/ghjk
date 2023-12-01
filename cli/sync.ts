import { Command } from "../deps/cli.ts";
import { GhjkCtx } from "../modules/ports/mod.ts";
import { sync } from "../modules/ports/sync.ts";
export class SyncCommand extends Command {
  constructor(
    public cx: GhjkCtx,
  ) {
    super();
    this
      .description("Syncs the runtime.")
      .action(() => sync(cx));
  }
}
