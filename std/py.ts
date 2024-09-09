import { EnvBuilder } from "../files/mod.ts";
import * as ports from "../ports/mod.ts";

interface PyEnvConfig {
  install?: {
    /** Python version */
    version: string;
    releaseTag: string;
  };
  /** venv dir, relative to Ghjk dir; default: ".venv" */
  dir?: string;
  /** create the venv if missing; default: true */
  create?: boolean;
}

export function pyEnv(
  { install, dir = ".venv", create = true }: PyEnvConfig = {},
) {
  return (builder: EnvBuilder, ghjk) => {
    if (install) {
      const { version, releaseTag } = install;
      builder.install(
        ports.cpy_bs({ version, releaseTag }),
      );
    }
    if (create) {
      builder.onEnter(ghjk.task({
        name: "create-py-venv",
        fn: async ($, { workingDir }) => {
          const venvDir = $.path(workingDir).join(dir);
          if (!(await venvDir.exists())) {
            await $`echo "Creating python venv at ${dir}"`;
            await $`python3 -m venv ${dir}`;
          }
        },
      }));
    }

    builder.var("VIRTUAL_ENV", ($, { workingDir }) => {
      const venvDir = $.path(workingDir).join(dir);
      return venvDir.toString();
    });

    builder.execDir(($, { workingDir }) => {
      const path = $.path(workingDir).join(dir).join("bin");
      return path.toString();
    });
  };
}
