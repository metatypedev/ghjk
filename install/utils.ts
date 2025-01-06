//! Please keep these in sync with `./ghjk.ts`

import type { GhjkCtx } from "../modules/types.ts";

/**
 * Returns a simple posix function to invoke the ghjk CLI.
 * This shim assumes it's running inside the ghjk embedded deno runtime.
 */
export function ghjk_sh(
  gcx: GhjkCtx,
  functionName = "__ghjk_shim",
) {
  return `${functionName} () {
    GHJKDIR="${gcx.ghjkDir}" \\
    ${Deno.execPath()} "$@"
}`;
}

/**
 * Returns a simple fish function to invoke the ghjk CLI.
 * This shim assumes it's running inside the ghjk embedded deno runtime.
 */
export function ghjk_fish(
  gcx: GhjkCtx,
  functionName = "__ghjk_shim",
) {
  return `function ${functionName}
    GHJKDIR="${gcx.ghjkDir}" \\
    ${Deno.execPath()}  $argv
end`;
}
