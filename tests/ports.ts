import "../setup_logger.ts";
import { DenoFileSecureConfig, stdSecureConfig } from "../mod.ts";
import { E2eTestCase, genTsGhjkFile, harness } from "./utils.ts";
import * as ports from "../ports/mod.ts";
import dummy from "../ports/dummy.ts";
import type { InstallConfigFat } from "../modules/ports/types.ts";

type CustomE2eTestCase = Omit<E2eTestCase, "ePoints" | "tsGhjkfileStr"> & {
  ePoint: string;
  installConf: InstallConfigFat | InstallConfigFat[];
  secureConf?: DenoFileSecureConfig;
};
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
  // 3 megs
  {
    name: "protoc",
    installConf: ports.protoc(),
    ePoint: `protoc --version`,
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
    secureConf: stdSecureConfig({
      enableRuntimes: true,
    }),
  },
  // node + more megs
  {
    name: "npmi-jco",
    installConf: ports.npmi({ packageName: "@bytecodealliance/jco" }),
    ePoint: `jco --version`,
    secureConf: stdSecureConfig({
      enableRuntimes: true,
    }),
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
    ePoint: Deno.env.get("GHJK_TEST_E2E_TYPE") != "local"
      // meta cli runs into segmentation error in the alpine
      // image
      // https://github.com/metatypedev/metatype/issues/584
      // just check that the shell's able to find the
      // executrable
      ? `which meta && wasmedge --version`
      : `meta --version && wasmedge --version`,
  },
  // 77 meg +
  {
    name: "asdf-cmake",
    installConf: ports.asdf({
      pluginRepo: "https://github.com/asdf-community/asdf-cmake",
      installType: "version",
    }),
    ePoint: `cmake --version`,
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
    secureConf: stdSecureConfig({
      enableRuntimes: true,
    }),
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
    ePoint: `sd --version`,
  },
];

harness(cases.map((testCase) => ({
  ...testCase,
  tsGhjkfileStr: genTsGhjkFile(
    {
      installConf: testCase.installConf,
      secureConf: testCase.secureConf,
      taskDefs: [],
    },
  ),
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
  // building the test docker image might taka a while
  // but we don't want some bug spinlocking the ci for
  // an hour
  timeout_ms: 5 * 60 * 1000,
  name: `ports/${testCase.name}`,
})));
