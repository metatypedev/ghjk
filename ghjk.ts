// @ts-nocheck: Ghjkfile based on Deno

export { sophon } from "./hack.ts";
import { config, install, task } from "./hack.ts";
import * as ports from "./ports/mod.ts";
import { sedLock } from "./std.ts";

config({
  defaultBaseEnv: "test",
  enableRuntimes: true,
  allowedBuildDeps: [ports.cpy_bs({ version: "3.12.7" })],
});

// these are just for quick testing
install();

const DENO_VERSION = "1.44.2";

// these are used for developing ghjk
install(
  ports.act(),
  ports.pipi({ packageName: "pre-commit" })[0],
  ports.pipi({ packageName: "vale" })[0],
  ports.deno_ghrel({ version: DENO_VERSION }),
);

task(
  "lock-sed",
  async ($) => {
    const GHJK_VERSION = "0.3.0";
    await sedLock(
      $.path(import.meta.dirname!),
      {
        lines: {
          "./.github/workflows/*.yml": [
            [/(DENO_VERSION: ").*(")/, DENO_VERSION],
          ],
          "./host/mod.ts": [
            [/(GHJK_VERSION = ").*(")/, GHJK_VERSION],
          ],
          "./install.sh": [
            [/(GHJK_VERSION="\$\{GHJK_VERSION:-v).*(\}")/, GHJK_VERSION],
            [/(DENO_VERSION="\$\{DENO_VERSION:-v).*(\}")/, DENO_VERSION],
          ],
          "./docs/*.md": [
            [
              /(.*\/metatypedev\/ghjk\/v)[^/]*(\/.*)/,
              GHJK_VERSION,
            ],
            [
              /(GHJK_VERSION\s*=\s*v)[^\s]*(.*)/,
              GHJK_VERSION,
            ],
          ],
          "./README.md": [
            [
              /(.*\/metatypedev\/ghjk\/v)[^/]*(\/.*)/,
              GHJK_VERSION,
            ],
          ],
        },
        ignores: [
          // ignore this file to avoid hits on the regexps
          `ghjk.ts`,
          `.git`,
          // TODO: std function for real ignore handling
          ...(await $.path(".gitignore").readText())
            .split("\n")
            .map((l) => l.trim())
            .filter((line) => line.length > 0)
            .map((l) => `${l}${l.endsWith("*") ? "" : "*"}`),
          ...(await $.path(".ghjk/.gitignore").readText())
            .split("\n")
            .map((l) => l.trim())
            .filter((line) => line.length > 0)
            .map((l) => `.ghjk/${l}${l.endsWith("*") ? "" : "*"}`),
        ],
      },
    );
  },
);
