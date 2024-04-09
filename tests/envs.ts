import "../setup_logger.ts";
import {
  dockerE2eTest,
  E2eTestCase,
  type EnvDefArgs,
  genTsGhjkFile,
  localE2eTest,
} from "./utils.ts";
import dummy from "../ports/dummy.ts";

type CustomE2eTestCase = Omit<E2eTestCase, "ePoints" | "tsGhjkfileStr"> & {
  ePoint: string;
  stdin: string;
  envs: EnvDefArgs[];
};

const envVarTestEnvs: EnvDefArgs[] = [
  {
    name: "main",
    vars: {
      SONG: "ditto",
    },
  },
  {
    name: "sss",
    vars: {
      SING: "Seoul Sonyo Sound",
    },
  },
  {
    name: "yuki",
    envBase: false,
    vars: {
      HUMM: "Soul Lady",
    },
  },
];
const envVarTestsPosix = `
set -ex
# by default, we should be in main
[ "$SONG" = "ditto" ] || exit 101

ghjk envs cook sss
. .ghjk/envs/sss/activate.sh
# by default, envs should be based on main
# so they should inherit it's env vars
[ "$SONG" = "ditto" ] || exit 102
[ "$SING" = "Seoul Sonyo Sound" ] || exit 103

# go back to main and "sss" variables shouldn't be around
. .ghjk/envs/main/activate.sh
[ "$SONG" = "ditto" ] || exit 104
[ "$SING" = "Seoul Sonyo Sound" ] && exit 105

# env base is false for "yuki" and thus no vars from "main"
ghjk envs cook yuki
. .ghjk/envs/yuki/activate.sh
[ "$SONG" = "ditto" ] && exit 102
[ "$HUMM" = "Soul Lady" ] || exit 103
`;
const envVarTestsFish = `
# by default, we should be in main
test "$SONG" = "ditto"; or exit 101;

ghjk envs cook sss
. .ghjk/envs/sss/activate.fish
# by default, envs should be based on main
# so they should inherit it's env vars
test "$SONG" = "ditto"; or exit 103
test "$SING" = "Seoul Sonyo Sound"; or exit 104

# go back to main and "sss" variables shouldn't be around
. .ghjk/envs/main/activate.fish
test $SONG" = "ditto"; or exit 105
test $SING" = "Seoul Sonyo Sound"; and exit 106

# env base is false for "yuki" and thus no vars from "main"
ghjk envs cook yuki
. .ghjk/envs/yuki/activate.fish
test "$SONG" = "ditto"; and exit 107
test "$HUMM" = "Soul Lady"; or exit 108
`;

const installTestEnvs: EnvDefArgs[] = [
  {
    name: "main",
    installs: [
      dummy({ output: "main" }),
    ],
  },
  {
    name: "foo",
    envBase: false,
    installs: [
      dummy({ output: "foo" }),
    ],
  },
];

const installTestsPosix = `
set -eux
# by default, we should be in main
[ "$(dummy)" = "main" ] || exit 101;

ghjk envs cook foo
. .ghjk/envs/foo/activate.sh
[ "$(dummy)" = "foo" ] || exit 102;

. .ghjk/envs/main/activate.sh
[ "$(dummy)" = "main" ] || exit 102;
`;

const installTestsFish = `
# by default, we should be in main
test (dummy) = "main"; or exit 101;

ghjk envs cook foo
. .ghjk/envs/foo/activate.fish
test (dummy) = "foo"; or exit 102;

. .ghjk/envs/main/activate.fish
test (dummy) = "main"; or exit 102;
`;

const cases: CustomE2eTestCase[] = [
  {
    name: "prov_env_vars_bash",
    ePoint: `bash -s`,
    envs: envVarTestEnvs,
    stdin: envVarTestsPosix,
  },
  {
    name: "prov_env_vars_zsh",
    ePoint: `zsh -s`,
    envs: envVarTestEnvs,
    stdin: envVarTestsPosix,
  },
  {
    name: "prov_env_vars_fish",
    ePoint: `fish`,
    envs: envVarTestEnvs,
    stdin: envVarTestsFish,
  },
  {
    name: "prov_port_installs_bash",
    ePoint: `bash -l`,
    envs: installTestEnvs,
    stdin: installTestsPosix,
  },
  {
    name: "prov_port_installs_zsh",
    ePoint: `zsh -l`,
    envs: installTestEnvs,
    stdin: installTestsPosix,
  },
  {
    name: "prov_port_installs_fish",
    ePoint: `fish`,
    envs: installTestEnvs,
    stdin: installTestsFish,
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
      `${testGroup} - ${testCase.name}`,
      () =>
        testFn({
          ...testCase,
          tsGhjkfileStr: genTsGhjkFile(
            { envDefs: testCase.envs },
          ),
          ePoints: [{ cmd: testCase.ePoint, stdin: testCase.stdin }],
          envVars: {
            ...defaultEnvs,
            ...testCase.envVars,
          },
        }),
    );
  }
}

const e2eType = Deno.env.get("GHJK_TEST_E2E_TYPE");
if (e2eType == "both") {
  testMany("envsDockerE2eTest", cases, dockerE2eTest);
  testMany(`envsLocalE2eTest`, cases, localE2eTest);
} else if (e2eType == "local") {
  testMany("envsLocalE2eTest", cases, localE2eTest);
} else if (
  e2eType == "docker" ||
  !e2eType
) {
  testMany("envsDockerE2eTest", cases, dockerE2eTest);
} else {
  throw new Error(
    `unexpected GHJK_TEST_E2E_TYPE: ${e2eType}`,
  );
}
