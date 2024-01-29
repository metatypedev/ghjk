import "../setup_logger.ts";
import { secureConfig, stdDeps } from "../mod.ts";
import {
  dockerE2eTest,
  E2eTestCase,
  localE2eTest,
  tsGhjkFileFromInstalls,
} from "./utils.ts";
import * as ports from "../ports/mod.ts";
import type {
  InstallConfigFat,
  PortsModuleSecureConfig,
} from "../modules/ports/types.ts";

type CustomE2eTestCase = Omit<E2eTestCase, "ePoints" | "tsGhjkfileStr"> & {
  ePoint: string;
  installConf: InstallConfigFat | InstallConfigFat[];
  secureConf?: PortsModuleSecureConfig;
  ignore?: boolean;
};
// order tests by download size to make failed runs less expensive
const cases: CustomE2eTestCase[] = [
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
  // 16 megs
  {
    name: "wasmedge",
    installConf: ports.wasmedge(),
    ePoint: `wasmedge --version`,
  },
  // 23 megs
  {
    name: "temporal",
    installConf: ports.temporal_cli(),
    ePoint: `temporal --version`,
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
    secureConf: secureConfig({
      allowedPortDeps: stdDeps({ enableRuntimes: true }),
    }),
  },
  // node + more megs
  {
    name: "npmi-jco",
    installConf: ports.npmi({ packageName: "@bytecodealliance/jco" }),
    ePoint: `jco --version`,
    secureConf: secureConfig({
      allowedPortDeps: stdDeps({ enableRuntimes: true }),
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
    secureConf: secureConfig({
      allowedPortDeps: stdDeps({ enableRuntimes: true }),
    }),
  },
  // rustup +  600 megs
  {
    name: "rust",
    installConf: ports.rust({
      components: ["rust-analyzer"],
      targets: ["wasm32-unknown-unknown"],
      profile: "minimal",
      ...(
        Deno.build.os == "linux" &&
          Deno.env.get("GHJK_TEST_E2E_TYPE") == "docker"
          ? {
            // tests are run on alpine docker
            host: Deno.build.arch == "x86_64"
              ? "x86_64-unknown-linux-musl"
              : "aarch64-unknown-linux-musl",
          }
          : {}
      ),
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
        ...(
          Deno.build.os == "linux" &&
            Deno.env.get("GHJK_TEST_E2E_TYPE") == "docker"
            ? {
              // tests are run on alpine docker
              host: Deno.build.arch == "x86_64"
                ? "x86_64-unknown-linux-musl"
                : "aarch64-unknown-linux-musl",
            }
            : {}
        ),
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
        ...(
          Deno.build.os == "linux" &&
            Deno.env.get("GHJK_TEST_E2E_TYPE") == "docker"
            ? {
              // tests are run on alpine docker
              host: Deno.build.arch == "x86_64"
                ? "x86_64-unknown-linux-musl"
                : "aarch64-unknown-linux-musl",
            }
            : {}
        ),
      },
    }),
    ePoint: `sd --version`,
  },
];

function testMany(
  testGroup: string,
  cases: CustomE2eTestCase[],
  testFn: (inp: E2eTestCase) => Promise<void>,
  defaultEnvs: Record<string, string> = {},
) {
  for (const testCase of cases) {
    Deno.test(
      {
        name: `${testGroup} - ${testCase.name}`,
        ignore: testCase.ignore,
        fn: () =>
          testFn({
            ...testCase,
            tsGhjkfileStr: tsGhjkFileFromInstalls(
              {
                installConf: testCase.installConf,
                secureConf: testCase.secureConf,
                taskDefs: [],
              },
            ),
            ePoints: [
              ...["bash -c", "fish -c", "zsh -c"].map((sh) => ({
                cmd: `env ${sh} '${testCase.ePoint}'`,
              })),
              // FIXME: better tests for the `InstallDb`
              // installs db means this shouldn't take too long
              // as it's the second sync
              { cmd: "env bash -c 'timeout 1 ghjk ports sync'" },
            ],
            envs: {
              ...defaultEnvs,
              ...testCase.envs,
            },
          }),
      },
    );
  }
}

const e2eType = Deno.env.get("GHJK_TEST_E2E_TYPE");
if (e2eType == "both") {
  testMany("portsDockerE2eTest", cases, dockerE2eTest);
  testMany(`portsLocalE2eTest`, cases, localE2eTest);
} else if (e2eType == "local") {
  testMany("portsLocalE2eTest", cases, localE2eTest);
} else if (
  e2eType == "docker" ||
  !e2eType
) {
  testMany("portsDockerE2eTest", cases, dockerE2eTest);
} else {
  throw new Error(
    `unexpected GHJK_TEST_E2E_TYPE: ${e2eType}`,
  );
}
