import getLogger from "../../deno_utils/logger.ts";
import { Ghjk } from "../../ghjk/js/runtime.js";

const logger = getLogger(import.meta);

export async function reduceAndCookEnv(
  { envKey, envDir, createShellLoaders = false }: {
    envKey: string;
    envDir: string;
    createShellLoaders?: boolean;
  },
) {
  logger.debug("cooking env", envKey, { envDir });

  const envVars = await Ghjk.hostcall("reduce_and_cook_env_to", {
    envKey,
    envDir,
    createShellLoaders,
  }) as Record<string, string>;

  return {
    env: envVars,
  };
}
