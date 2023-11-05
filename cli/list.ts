import { Command } from "./deps.ts";

export class ListCommand extends Command {
  constructor() {
    super();
    this
      .description("")
      .action(async () => {
        console.log("list");
      });
  }
}
