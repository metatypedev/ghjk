//! dependencies used by the cli

export * from "./common.ts";

export { Err, Ok } from "https://deno.land/x/monads@v0.5.10/mod.ts";
export type { Result } from "https://deno.land/x/monads@v0.5.10/mod.ts";
export * as cliffy_cmd from "https://deno.land/x/cliffy@v1.0.0-rc.3/command/mod.ts";
export {
  Command,
  type CommandResult,
  CompletionsCommand,
} from "https://deno.land/x/cliffy@v1.0.0-rc.3/command/mod.ts";
