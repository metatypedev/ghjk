import { SyncCommand } from "./cli/sync.ts";
import { Command, CompletionsCommand } from "./deps.ts";

export async function ghjk(args: string[]) {
  const cli = new Command()
    .name("ghjk")
    .version("0.1.0")
    .description("Programmable runtime manager.")
    .action(() => {
      cli.showHelp();
    })
    .command("sync", new SyncCommand())
    .command("completions", new CompletionsCommand());

  await cli.parse(args);
}
