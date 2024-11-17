#!/bin/env -S ghjk deno run --allow-env --allow-run --allow-read --allow-write=.

import "../setup_logger.ts";
import { $ } from "../utils/mod.ts";

const files = (await Array.fromAsync(
  $.path(import.meta.url).parentOrThrow().expandGlob("**/*.ts", {
    exclude: [
      ".git",
      ".dev",
      "play.ts",
      ".ghjk/**",
      ".deno-dir/**",
      "vendor/**",
      ".git/**", // was throwing an error without this
      "./target",
    ],
  }),
)).map((ref) => ref.path.toString());

await $`${Deno.env.get("DENO_EXEC_PATH") ?? "deno"} check ${files}`;
