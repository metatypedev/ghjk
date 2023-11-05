import { Command, dirname, exists, resolve } from "../deps.ts";
import { dirs } from "../utils.ts";

async function findConfig(path: string): Promise<string | null> {
  let current = path;
  while (current !== "/") {
    const location = `${path}/ghjk.ts`;
    if (await exists(location)) {
      return location;
    }
    current = dirname(current);
  }
  return null;
}

function shimFromConfig(config: string): string {
  const { shareDir } = dirs();
  return resolve(shareDir, "shims", dirname(config).replaceAll("/", "."));
}

async function writeLoader(shim: string, env: Record<string, string>) {
  await Deno.mkdir(shim, { recursive: true });
  await Deno.writeTextFile(
    `${shim}/loader.fish`,
    Object.entries(env).map(([k, v]) =>
      `set --global --append GHJK_CLEANUP "set --global --export ${k} '$k';"; set --global --export ${k} '${v}'`
    ).join("\n"),
  );
}

export class SyncCommand extends Command {
  constructor() {
    super();
    this
      .description("Syncs the runtime.")
      .action(async () => {
        const config = await findConfig(Deno.cwd());
        console.log(config);
        if (!config) {
          console.log("ghjk did not find any `ghjk.ts` config.");
          return;
        }
        const shim = shimFromConfig(config);
        await writeLoader(shim, { "TEST_VAL": "1" });
        console.log(shim);
      });
  }
}
