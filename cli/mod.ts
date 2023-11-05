import { SyncCommand } from "./sync.ts";
import { Command, CommandResult, CompletionsCommand } from "./deps.ts";
import { ListCommand } from "./list.ts";
import { OutdatedCommand } from "./outdated.ts";
import { CleanupCommand } from "./cleanup.ts";

function runCli(args: string[]): Promise<CommandResult> {
  return new Command()
    .name("ghjk")
    .version("0.1.0")
    .description("Programmable runtime manager.")
    .action(function () {
      this.showHelp();
    })
    .command("sync", new SyncCommand())
    .command("list", new ListCommand())
    .command("outdated", new OutdatedCommand())
    .command("cleanup", new CleanupCommand())
    .command("completions", new CompletionsCommand())
    .parse(args);
}

export const ghjk = {
  runCli,
  tools: [],
  tasks: [],
};
