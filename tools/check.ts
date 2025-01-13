#!/bin/env -S ghjk deno run --allow-env --allow-run --allow-read --allow-write=.

import "../src/deno_utils/setup_logger.ts";
import { $ } from "../src/deno_utils/mod.ts";

const files = (await Array.fromAsync(
  $.path(import.meta.url).parentOrThrow().parentOrThrow().expandGlob(
    "**/*.ts",
    {
      exclude: [
        ".git",
        ".dev",
        "play.ts",
        ".ghjk/**",
        ".deno-dir/**",
        "vendor/**",
        ".git/**", // was throwing an error without this
        "target/",
      ],
    },
  ),
)).map((ref) => ref.path.toString());

await $`bash -c "xargs deno check"`.stdinText(files.join(" "));
