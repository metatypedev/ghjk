import { Command } from "./deps.ts";

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
