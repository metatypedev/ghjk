import "../setup_logger.ts";
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

// order tests by download size to make failed runs less expensive
const cases: E2eTestCase[] = [
  ...(Deno.build.os == "linux"
    ? [
      // 8 megs
      {
        name: "mold",
        installConf: mold(),
        ePoint: `mold -V`,
      },
    ]
    : []),

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
  },
];

function testlManyE2e(
  cases: E2eTestCase[],
  testFn: (inp: E2eTestCase) => Promise<void>,
  defaultEnvs: Record<string, string> = {},
) {
  for (const testCase of cases) {
    Deno.test(
      `localE2eTest - ${testCase.name}`,
      () =>
        testFn({
          ...testCase,
          envs: {
            ...defaultEnvs,
            ...testCase.envs,
          },
        }),
    );
  }
}

if (Deno.env.get("GHJK_E2E_TYPE") == "both") {
  testlManyE2e(cases, dockerE2eTest);
  testlManyE2e(cases, localE2eTest);
} else if (Deno.env.get("GHJK_TEST_E2E_TYPE") == "local") {
  testlManyE2e(cases, localE2eTest);
} else if (
  Deno.env.get("GHJK_TEST_E2E_TYPE") == "docker" ||
  !Deno.env.has("GHJK_TEST_E2E_TYPE")
) {
  testlManyE2e(cases, dockerE2eTest);
} else {
  throw new Error(
    `unexpected GHJK_TEST_E2E_TYPE: ${Deno.env.get("GHJK_TEST_E2E_TYPE")}`,
  );
}
