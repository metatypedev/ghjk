import { Command } from "../deps/cli.ts";

export class CleanupCommand extends Command {
  constructor() {
    super();
    this
      .description("")
      .action(async () => {
        console.log("cleanup");
      });
  }
}
