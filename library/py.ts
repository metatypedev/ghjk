import { EnvBuilder } from "../files/mod.ts";
import { cpy_bs } from "../ports/mod.ts";
import * as ports from "../ports/mod.ts";

interface PyEnvConfig {
  /** Python version */
  version: string;
  releatTag: string;
  /** venv dir, relative to Ghjk dir; default: ".venv" */
  dir?: string;
  /** create the venv if missing; default: true */
  create?: boolean;
}

export function pyEnv(
  { version, releaseTag, dir = ".venv", create = true }: PyEnvConfig = {},
) {
  return (builder: EnvBuilder, ghjk) => {
    console.log({ version, releaseTag });
    if (create) {
      builder.onEnter(ghjk.task({
        name: "activate-py-venv",
        installs: [
          ports.cpy_bs({ version, releaseTag }),
          ports.jq_ghrel(),
        ],
        vars: { STUFF: "stuffier" },
        fn: async ($, { workingDir }) => {
          console.log("dir", { dir, workingDir });
          const venvDir = $.path(workingDir).join(dir);
          console.log(await venvDir.exists());
          if (!(await venvDir.exists())) {
            await $`echo "Creating python venv at ${dir}"`;
            await $`python3 -m venv ${dir}`;
          }
          await $`python3 --version`;
          await $`echo $STUFF; jq --version`;
          return $`echo enter`;
        },
        installs: [],
      }));
    }
  };
}
