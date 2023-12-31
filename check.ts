import "./setup_logger.ts";
import { $ } from "./utils/mod.ts";

const files = (await Array.fromAsync(
  $.path(import.meta.url).parentOrThrow().expandGlob("**/*.ts", {
    exclude: [],
  }),
)).map((ref) => ref.path.toString());

await $`${Deno.execPath()} check ${files}`;
