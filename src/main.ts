import { SyncCommand } from "./sync.ts";
import { Command, CommandResult, CompletionsCommand } from "./deps.ts";

function runCli(args: string[]): Promise<CommandResult> {
  return new Command()
    .name("ghjk")
    .version("0.1.0")
    .description("Programmable runtime manager.")
    .action(function () {
      this.showHelp();
    })
    .command("sync", new SyncCommand())
    .command("completions", new CompletionsCommand())
    .parse(args);
}

export const ghjk = {
  runCli,
};
