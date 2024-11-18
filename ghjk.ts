// @ts-nocheck: Ghjkfile based on Deno

export { sophon } from "./hack.ts";
import { config, env, install, task } from "./hack.ts";
import { switchMap } from "./port.ts";
import * as ports from "./ports/mod.ts";
import { sedLock } from "./std.ts";
import { dbg, downloadFile, DownloadFileArgs } from "./utils/mod.ts";
import { unarchive } from "./utils/unarchive.ts";

config({
  defaultEnv: "dev",
  enableRuntimes: true,
  allowedBuildDeps: [ports.cpy_bs({ version: "3.12.7" })],
});

env("_rust")
  .install(
    ports.protoc(),
    ports.pipi({ packageName: "cmake" })[0],
    // keep in sync with deno's reqs
    ports.rust({
      version: "1.82.0",
      profile: "default",
      components: ["rustfmt", "clippy", "rust-src"],
    }),
  );

const RUSTY_V8_MIRROR = `${import.meta.dirname}/.dev/rusty_v8`;

env("dev")
  .inherit("_rust")
  .vars({
    RUSTY_V8_MIRROR,
  });

if (Deno.build.os == "linux" && !Deno.env.has("NO_MOLD")) {
  const mold = ports.mold({
    version: "v2.4.0",
    replaceLd: true,
  });
  env("dev").install(mold);
}

// these  are just for quick testing
install();

const DENO_VERSION = "2.0.6";

// these are used for developing ghjk
install(
  ports.act(),
  ports.pipi({ packageName: "pre-commit" })[0],
  ports.pipi({ packageName: "vale" })[0],
  ports.deno_ghrel({ version: DENO_VERSION }),
);

task(
  "cache-v8",
  {
    desc: "Install the V8 builds to a local cache.",
    inherit: "_rust",
    fn: async ($) => {
      const tmpDirPath = await Deno.makeTempDir({});
      const v8Versions = (await $`cargo tree -p v8 --depth 0 --locked`
        .text())
        .matchAll(/^v8 (v[\d.]*)/)
        .map((match) => match[1]);

      $.co(
        v8Versions.map(
          async (version) => {
            const archiveName = `librusty_v8_release_${Deno.build.arch}-${
              switchMap(Deno.build.os, {
                linux: "unknown-linux-gnu",
                darwin: "apple-darwin",
              }) ?? "NOT_SUPPORTED"
            }.a.gz`;
            const archivePath = await downloadFile(
              {
                url:
                  `https://github.com/denoland/rusty_v8/releases/download/${version}/${archiveName}`,
                downloadPath: $.path(RUSTY_V8_MIRROR).join(version)
                  .toString(),
                tmpDirPath,
              } satisfies DownloadFileArgs,
            );
          },
        ),
      );
      await $.path(tmpDirPath).remove({ recursive: true });
    },
  },
);

task(
  "lock-sed",
  async ($) => {
    const GHJK_VERSION = "0.3.0";
    await sedLock(
      $.path(import.meta.dirname!),
      {
        lines: {
          "./Cargo.toml": [
            [/^(version = ").*(")/, GHJK_VERSION],
          ],
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
