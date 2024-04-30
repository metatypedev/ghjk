#!/bin/env -S ghjk deno run --allow-env --allow-run --allow-read --allow-write=.
// # FIXME: find a way to resolve !DENO_EXEC_PATH in shebangs

import "./setup_logger.ts";
import { $ } from "./utils/mod.ts";

const files = (await Array.fromAsync(
  $.path(import.meta.url).parentOrThrow().expandGlob("**/*.ts", {
    exclude: [
      "play.ts",
      ".ghjk/**",
      ".deno-dir/**",
      "vendor/**",
    ],
  }),
)).map((ref) => ref.path.toString());

await $`${Deno.env.get("DENO_EXEC_PATH") ?? "deno"} check ${files}`;
