import "../src/deno_utils/setup_logger.ts";
import type { FileArgs } from "../src/ghjk_ts/mod.ts";
import { E2eTestCase, genTsGhjkFile, harness } from "./utils.ts";
import * as ports from "../ports/mod.ts";
import dummy from "../ports/dummy.ts";
import type { InstallConfigFat } from "../src/sys_deno/ports/types.ts";
import { testTargetPlatform } from "./utils.ts";

type CustomE2eTestCase = Omit<E2eTestCase, "ePoints" | "fs"> & {
  ePoint: string;
  installConf: InstallConfigFat | InstallConfigFat[];
  secureConf?: FileArgs;
};

// FIXME: where did the asdf test go?

// order tests by download size to make failed runs less expensive
const cases: CustomE2eTestCase[] = [
  // 0 megs
  {
    name: "dummy",
    installConf: dummy(),
    ePoint: `dummy`,
  },
  // 2 megs
  {
    name: "jq",
    installConf: ports.jq_ghrel(),
    ePoint: `jq --version`,
  },
  {
    name: "asdf-jq",
    ePoint: `jq --version`,
    installConf: ports.asdf({
      pluginRepo: "https://github.com/lsanwick/asdf-jq",
      installType: "version",
    }),
    secureConf: {
      enableRuntimes: true,
    },
  },
  // 3 megs
  {
    name: "protoc",
    installConf: ports.protoc(),
    ePoint: `protoc --version`,
  },
  {
    name: "lade",
    installConf: ports.protoc(),
    ePoint: `lade --version`,
  },
  // 6 megs
  {
    name: "ruff",
    installConf: ports.ruff(),
    ePoint: `ruff --version`,
  },
  // 7 megs
  {
    name: "act",
    installConf: ports.act(),
    ePoint: `act --version`,
  },
  // 7 megs
  {
    name: "cargo-binstall",
    installConf: ports.cargo_binstall(),
    ePoint: `cargo-binstall -V`,
  },
  // 8 megs
  {
    name: "mold",
    installConf: ports.mold(),
    ePoint: `mold -V`,
    ignore: Deno.build.os != "linux",
  },
  // 9 megs
  {
    name: "infisical",
    installConf: ports.infisical(),
    ePoint: `infisical --version`,
  },
  // 13 megs
  {
    name: "rustup",
    installConf: ports.rustup(),
    ePoint: `rustup-init --version`,
  },
  // 15 megs
  {
    name: "fx_ghrel",
    installConf: ports.fx_ghrel(),
    ePoint: `fx --version`,
  },
  // 22 megs
  {
    name: "livekit_cli_ghrel",
    installConf: ports.livekit_cli_ghrel(),
    ePoint: `lk --version`,
    ignore: Deno.build.os == "darwin",
  },
  // 23 megs
  {
    name: "temporal",
    installConf: ports.temporal_cli(),
    ePoint: `temporal --version`,
  },
  // 23 megs
  {
    name: "opentofu",
    installConf: ports.opentofu_ghrel(),
    ePoint: `tofu --version`,
  },
  // 24 megs
  {
    name: "terraform",
    installConf: ports.terraform(),
    ePoint: `terraform --version`,
  },
  // 25 megs
  {
    name: "node",
    installConf: ports.node(),
    ePoint: `node --version`,
  },
  // node + 11 megs
  {
    name: "npmi-node-gyp",
    installConf: ports.npmi({ packageName: "node-gyp" }),
    ePoint: `node-gyp --version`,
    secureConf: {
      enableRuntimes: true,
    },
  },
  // node + more megs
  {
    name: "npmi-jco",
    installConf: ports.npmi({ packageName: "@bytecodealliance/jco" }),
    ePoint: `jco --version`,
    secureConf: {
      enableRuntimes: true,
    },
  },
  {
    name: "deno",
    installConf: ports.deno_ghrel(),
    ePoint: `deno --version`,
  },
  // 42 megs
  {
    name: "earthly",
    installConf: ports.earthly(),
    ePoint: `earthly --version`,
  },
  // 56 megs
  {
    name: "pnpm",
    installConf: ports.pnpm(),
    ePoint: `pnpm --version`,
  },
  // 70 megs + 16 megs
  {
    name: "meta-cli-and-wasmedge",
    installConf: [
      ports.meta_cli_ghrel({ full: true }),
      ports.wasmedge(),
    ],
    ePoint: `which meta && wasmedge --version`,
    ignore: testTargetPlatform == "linux/aarch64",
  },
  // 80 meg
  {
    name: "cpy_bs",
    installConf: ports.cpy_bs(),
    ePoint: `python3 --version`,
  },
  // 80 meg +
  {
    name: "pipi-poetry",
    installConf: ports.pipi({ packageName: "poetry" }),
    ePoint: `poetry --version`,
    secureConf: {
      enableRuntimes: true,
    },
  },
  // 95 meg
  {
    name: "terragrunt",
    installConf: ports.terragrunt_ghrel({}),
    ePoint: `terragrunt --version`,
    secureConf: {
      enableRuntimes: true,
    },
  },
  // rustup +  600 megs
  {
    name: "rust",
    installConf: ports.rust({
      components: ["rust-analyzer"],
      targets: ["wasm32-unknown-unknown"],
      profile: "minimal",
    }),
    ePoint: `rustc --version`,
  },
  // rust + cargo_binstall + 14 megs
  {
    name: "cargobi-sd",
    installConf: ports.cargobi({
      crateName: "sd",
      rustConfOverride: {
        profile: "minimal",
      },
    }),
    secureConf: {
      enableRuntimes: true,
    },
    ePoint: `sd --version`,
  },
  // rust + cargo_binstall + 22 megs
  {
    name: "cargobi-sd",
    installConf: ports.cargobi({
      crateName: "sd",
      profile: "dev", // force to use cargo-install
      rustConfOverride: {
        profile: "minimal",
      },
    }),
    secureConf: {
      enableRuntimes: true,
    },
    ePoint: `sd --version`,
  },
];

harness(cases.map((testCase) => ({
  ...testCase,
  fs: {
    "ghjk.ts": genTsGhjkFile(
      {
        secureConf: {
          ...testCase.secureConf,
          installs: Array.isArray(testCase.installConf)
            ? testCase.installConf
            : [testCase.installConf],
        },
      },
    ),
  },
  ePoints: [
    ...["bash -c", "fish -c", "zsh -c"].map((sh) => ({
      cmd: [...`env ${sh}`.split(" "), `"${testCase.ePoint}"`],
    })),
    /* // FIXME: better tests for the `InstallDb`
      // installs db means this shouldn't take too long
      // as it's the second sync
      {
        cmd: [
          ..."env".split(" "),
          "bash -c 'timeout 1 ghjk envs cook'",
        ],
      }, */
  ],
  name: `ports/${testCase.name}`,
  timeout_ms: 10 * 60 * 1000,
})));
