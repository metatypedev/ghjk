import { node } from "../tools/node.ts";
import { Command, dirname, exists, resolve } from "./deps.ts";
import { dirs } from "./utils.ts";

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
        console.log(shim);

        // in the ghjk.ts the user will have declared some tools and tasks
        // we need to collect them through the `ghjk` object from main
        // (beware of multiple versions of tools libs)
        // here, only showing what should happen after as an example

        const nodeTool = node({ version: "v21.1.0" });

        // build dag

        // link shims
        const ASDF_INSTALL_VERSION = "v21.1.0";
        const ASDF_INSTALL_PATH = resolve(shim, "node", ASDF_INSTALL_VERSION);
        await Deno.mkdir(ASDF_INSTALL_PATH, { recursive: true });

        await nodeTool.install(
          { ASDF_INSTALL_VERSION, ASDF_INSTALL_PATH } as any,
        );

        for (
          const [bin, link] of Object.entries(
            await nodeTool.listBinPaths({} as any),
          )
        ) {
          const linkPath = `${shim}/${link}`;
          await Deno.remove(linkPath, { recursive: true });
          await Deno.symlink(
            `${ASDF_INSTALL_PATH}/${bin}`,
            linkPath,
            { type: "file" },
          );
        }

        // write shim if config changes or does not exists
        const env = await nodeTool.execEnv({ ASDF_INSTALL_PATH } as any);
        await writeLoader(shim, env);
      });
  }
}
