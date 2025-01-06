export { sophon } from "./src/ghjk_ts/mod.ts";
import { file } from "./src/ghjk_ts/mod.ts";

import * as ports from "./ports/mod.ts";
import { sedLock } from "./src/ghjk_ts/std.ts";
import {
  downloadFile,
  DownloadFileArgs,
  switchMap,
} from "./src/deno_utils/mod.ts";

const ghjk = file({});

const GHJK_VERSION = "0.3.0-rc.3";
const GHJK_PUBLISHED_VERSION = "0.3.0-rc.2";
const DENO_VERSION = "2.1.2";
// keep in sync with the deno repo's ./rust-toolchain.toml
const RUST_VERSION = "1.82.0";

ghjk.env("main")
  // these are used for developing ghjk
  .install(
    ports.act(),
    ports.pipi({ packageName: "pre-commit" })[0],
    ports.pipi({ packageName: "vale" })[0],
    ports.deno_ghrel({ version: DENO_VERSION }),
  );

const installs = {
  rust: ports.rust({
    version: RUST_VERSION,
    profile: "default",
    components: ["rust-src"],
  }),
};

ghjk.config({
  defaultEnv: "dev",
  enableRuntimes: true,
  allowedBuildDeps: [ports.cpy_bs({ version: "3.13.1" }), installs.rust],
});

const RUSTY_V8_MIRROR = `${import.meta.dirname}/.dev/rusty_v8`;

ghjk.env("_rust")
  .install(
    ports.protoc(),
    ports.pipi({ packageName: "cmake" })[0],
    installs.rust,
    ...(Deno.build.os == "linux" && !Deno.env.has("NO_MOLD")
      ? [ports.mold({
        version: "v2.4.0",
        replaceLd: true,
      })]
      : []),
  );

ghjk.env("dev")
  .inherit("_rust")
  .install(ports.cargobi({ crateName: "tokio-console" }))
  .install(ports.cargobi({ crateName: "cargo-bloat" }))
  .vars({
    // V8_FORCE_DEBUG: "true",
    RUSTY_V8_MIRROR,
  });

ghjk.env("ci")
  .inherit("_rust");

// these are just for quick testing
ghjk.install(
  ports.asdf({
    pluginRepo: "https://github.com/lsanwick/asdf-jq",
    installType: "version",
  }),
);

ghjk.env("main")
  .vars({
    RUST_LOG: [
      "info",
      Object.entries({
        "TRACE": [
          // "denort",
          // "deno",
        ],
        "DEBUG": [
          "runtime",
          "tokio",
        ],
        "INFO": [
          "deno::npm",
          "deno::file_fetcher",
          "swc_ecma_transforms_base",
          "swc_common",
          "h2",
          "rustls",
          "mio",
          "hyper_util",
        ],
      }).flatMap(([level, modules]) =>
        modules.map((module) => `${module}=${level.toLowerCase()}`)
      ),
    ].join(),
  });

ghjk.task(
  "cache-v8",
  {
    desc: "Install the V8 builds to a local cache.",
    inherit: false,
    fn: async ($) => {
      const tmpDirPath = await Deno.makeTempDir({});
      const v8Versions = [
        ...(await $`cargo tree -p v8 --depth 0 --locked`
          .text())
          .matchAll(/^v8 (v[\d.]*)/g)
          .map((match) => match[1]),
      ];

      await $.co(
        v8Versions
          .flatMap(
            (version) => {
              const os = switchMap(Deno.build.os, {
                linux: "unknown-linux-gnu",
                darwin: "apple-darwin",
              }) ?? "NOT_SUPPORTED";
              const arch = Deno.build.arch;
              return [
                `librusty_v8_release_${arch}-${os}.a.gz`,
                `librusty_v8_debug_${arch}-${os}.a.gz`,
              ].map((archiveName) => ({
                name: archiveName,
                url:
                  `https://github.com/denoland/rusty_v8/releases/download/${version}/${archiveName}`,
                downloadPath: $.path(RUSTY_V8_MIRROR).join(version).toString(),
                tmpDirPath,
              } satisfies DownloadFileArgs));
            },
          )
          .filter((args) =>
            !$.path(args.downloadPath).join(args.name).existsSync()
          )
          .map((args) => downloadFile(args)),
      );
      await $.path(tmpDirPath).remove({ recursive: true });
    },
  },
);

ghjk.task(
  "lock-sed",
  async ($) =>
    await sedLock(
      $.path(import.meta.dirname!),
      {
        lines: {
          "./rust-toolchain.toml": [
            [/^(channel = ").*(")/, RUST_VERSION],
          ],
          "./Cargo.toml": [
            [/^(version = ").*(")/, GHJK_VERSION],
          ],
          "./.github/workflows/*.yml": [
            [/(DENO_VERSION: ").*(")/, DENO_VERSION],
          ],
          "./docs/*.md": [
            [
              /(.*\/metatypedev\/ghjk\/v)[^/]*(\/.*)/,
              GHJK_PUBLISHED_VERSION,
            ],
            [
              /(GHJK_VERSION\s*=\s*v)[^\s]*(.*)/,
              GHJK_PUBLISHED_VERSION,
            ],
          ],
          "./README.md": [
            [
              /(.*\/metatypedev\/ghjk\/v)[^/]*(\/.*)/,
              GHJK_PUBLISHED_VERSION,
            ],
          ],
          "**/Cargo.toml": [
            [/^(version = ").+(")/, GHJK_VERSION],
            [
              /(deno\s*=\s*\{\s*git\s*=\s*"https:\/\/github\.com\/metatypedev\/deno"\s*,\s*branch\s*=\s*"v).+(-embeddable"\s*\})/,
              DENO_VERSION,
            ],
          ],
        },
        ignores: [
          // ignore this file to avoid hits on the regexps
          `ghjk.ts`,
          `.git`,
        ],
        ignoreFiles: [
          ".gitignore",
          ".ghjk/.gitignore",
        ],
      },
    ),
  { inherit: false },
);
