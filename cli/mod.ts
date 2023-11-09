import { Command, CommandResult, CompletionsCommand } from "../deps/cli.ts";

import { SyncCommand } from "./sync.ts";
import { ListCommand } from "./list.ts";
import { OutdatedCommand } from "./outdated.ts";
import { CleanupCommand } from "./cleanup.ts";
import { type GhjkCtx } from "../core/mod.ts";

export function runCli(args: string[], cx: GhjkCtx): Promise<CommandResult> {
  return new Command()
    .name("ghjk")
    .version("0.1.0")
    .description("Programmable runtime manager.")
    .action(function () {
      this.showHelp();
    })
    .command("sync", new SyncCommand(cx))
    .command("list", new ListCommand(cx))
    .command("outdated", new OutdatedCommand())
    .command("cleanup", new CleanupCommand())
    .command("completions", new CompletionsCommand())
    .parse(args);
}
