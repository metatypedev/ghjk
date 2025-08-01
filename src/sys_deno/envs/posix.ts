import type { GhjkCtx } from "../types.ts";
import getLogger from "../../deno_utils/logger.ts";
import { Ghjk } from "../../ghjk/js/runtime.js";

const logger = getLogger(import.meta);

export async function cookPosixEnv(
  { gcx, envKey, envDir, createShellLoaders = false }: {
    gcx: GhjkCtx;
    envKey: string;
    envDir: string;
    createShellLoaders?: boolean;
  },
) {
  logger.debug("cooking env", envKey, { envDir });
  
  const envVars = await Ghjk.hostcall("cook_posix_env", {
    envKey,
    envDir,
    createShellLoaders,
    ghjkDir: gcx.ghjkDir.toString(),
    dataDir: gcx.ghjkDataDir.toString(),
  }) as Record<string, string>;
  
  return {
    env: envVars
  };
}