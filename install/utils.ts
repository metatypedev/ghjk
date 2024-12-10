//! Please keep these in sync with `./ghjk.ts`

import type { GhjkCtx } from "../modules/types.ts";

/**
 * Returns a simple posix function to invoke the ghjk CLI.
 */
export function ghjk_sh(
  gcx: GhjkCtx,
  functionName = "__ghjk_shim",
) {
  return `${functionName} () {
    GHJK_DIR="${gcx.ghjkDir}" \\
    ${Deno.execPath()} "$@"
}`;
}

/**
 * Returns a simple fish function to invoke the ghjk CLI.
 */
export function ghjk_fish(
  gcx: GhjkCtx,
  functionName = "__ghjk_shim",
) {
  return `function ${functionName}
    GHJK_DIR="${gcx.ghjkDir}" \\
    ${Deno.execPath()}  $argv
end`;
}
