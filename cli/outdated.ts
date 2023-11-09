import { Command } from "../deps/cli.ts";

export class OutdatedCommand extends Command {
  constructor() {
    super();
    this
      .description("")
      .action(async () => {
        console.log("outdated");
      });
  }
}
