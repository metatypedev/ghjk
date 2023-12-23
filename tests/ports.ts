import "../setup_logger.ts";
import { secureConfig, stdDeps } from "../mod.ts";
import { dockerE2eTest, E2eTestCase, localE2eTest } from "./utils.ts";
import node from "../ports/node.ts";
import pnpm from "../ports/pnpm.ts";
import cargo_binstall from "../ports/cargo-binstall.ts";
import wasmedge from "../ports/wasmedge.ts";
import wasm_tools from "../ports/wasm-tools.ts";
import wasm_opt from "../ports/wasm-opt.ts";
import cargo_insta from "../ports/cargo-insta.ts";
import jco from "../ports/jco.ts";
import mold from "../ports/mold.ts";
import act from "../ports/act.ts";
import asdf from "../ports/asdf.ts";
import protoc from "../ports/protoc.ts";
import earthly from "../ports/earthly.ts";
import ruff from "../ports/ruff.ts";
import whiz from "../ports/whiz.ts";
import cpython from "../ports/cpy_bs.ts";
import pipi from "../ports/pipi.ts";

type CustomE2eTestCase = Omit<E2eTestCase, "ePoints"> & {
  ePoint: string;
  ignore?: boolean;
};
// order tests by download size to make failed runs less expensive
const cases: CustomE2eTestCase[] = [
  // 3 megs
  {
    name: "protoc",
    installConf: protoc(),
    ePoint: `protoc --version`,
  },
  // 6 megs
  {
    name: "ruff",
    installConf: ruff(),
    ePoint: `ruff --version`,
  },
  // 7 megs
  {
    name: "whiz",
    installConf: whiz(),
    ePoint: `whiz --version`,
  },
  // 7 megs
  {
    name: "act",
    installConf: act(),
    ePoint: `act --version`,
  },
  // 7 megs
  {
    name: "cargo-binstall",
    installConf: cargo_binstall(),
    ePoint: `cargo-binstall -V`,
  },
  // 8 megs
  {
    name: "mold",
    installConf: mold(),
    ePoint: `mold -V`,
    ignore: Deno.build.os != "linux",
  },
  // 16 megs
  {
    name: "wasmedge",
    installConf: wasmedge(),
    ePoint: `wasmedge --version`,
  },
  // cargo binstall +7 megs
  {
    name: "cargo-insta",
    installConf: cargo_insta(),
    ePoint: `cargo-insta -V`,
  },
  // cargo binsatll 13 megs
  {
    name: "wasm-tools",
    installConf: wasm_tools(),
    ePoint: `wasm-tools -V`,
  },
  // 25 megs
  {
    name: "node",
    installConf: node(),
    ePoint: `node --version`,
  },
  // cargo-binstall + 22 megs
  {
    name: "wasm-opt",
    installConf: wasm_opt(),
    ePoint: `wasm-opt --version`,
  },
  // 42 megs
  {
    name: "earthly",
    installConf: earthly(),
    ePoint: `earthly --version`,
  },
  // 56 megs
  {
    name: "pnpm",
    installConf: pnpm(),
    ePoint: `pnpm --version`,
  },
  // node + more megs
  {
    name: "jco",
    installConf: jco(),
    ePoint: `jco --version`,
    secureConf: secureConfig({
      allowedPortDeps: stdDeps({ enableRuntimes: true }),
    }),
  },
  // 77 meg +
  {
    name: "asdf-cmake",
    installConf: asdf({
      pluginRepo: "https://github.com/asdf-community/asdf-cmake",
      installType: "version",
    }),
    ePoint: `cmake --version`,
  },
  // 80 meg
  {
    name: "cpy_bs",
    installConf: cpython(),
    ePoint: `python3 --version`,
  },
  // 80 meg +
  {
    name: "pipi-poetry",
    installConf: pipi({ packageName: "poetry" }),
    ePoint: `poetry --version`,
    secureConf: secureConfig({
      allowedPortDeps: stdDeps({ enableRuntimes: true }),
    }),
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
            ePoints: [
              ...["bash -c", "fish -c", "zsh -c"].map((sh) => ({
                cmd: `env ${sh} '${testCase.ePoint}'`,
              })),
              // installs db means this shouldn't take too log
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
