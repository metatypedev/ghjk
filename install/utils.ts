//! Please keep these in sync with `./ghjk.ts`

import type { GhjkCtx } from "../modules/types.ts";
import { unstableFlags } from "./mod.ts";

/**
 * Returns a simple posix function to invoke the ghjk CLI.
 */
export function ghjk_sh(
  gcx: GhjkCtx,
  denoDir: string,
  functionName = "__ghjk_shim",
) {
  return `${functionName} () {
    GHJK_SHARE_DIR="${gcx.ghjkShareDir}" \\
    DENO_DIR="${denoDir}" \\
    DENO_NO_UPDATE_CHECK=1 \\
    GHJK_DIR="${gcx.ghjkDir}" \\
    ${Deno.execPath()} run ${
    unstableFlags.join(" ")
  } -A --lock ${gcx.ghjkDir}/deno.lock ${import.meta.resolve("../main.ts")} "$@"
}`;
}

/**
 * Returns a simple fish function to invoke the ghjk CLI.
 */
export function ghjk_fish(
  gcx: GhjkCtx,
  denoDir: string,
  functionName = "__ghjk_shim",
) {
  return `function ${functionName}
    GHJK_SHARE_DIR="${gcx.ghjkShareDir}" \\
    DENO_DIR="${denoDir}" \\
    DENO_NO_UPDATE_CHECK=1 \\
    GHJK_DIR="${gcx.ghjkDir}" \\
    ${Deno.execPath()} run ${
    unstableFlags.join(" ")
  } -A --lock ${gcx.ghjkDir}/deno.lock ${
    import.meta.resolve("../main.ts")
  } $argv
end`;
}
