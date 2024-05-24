import "../setup_logger.ts";
import {
  E2eTestCase,
  type EnvDefArgs,
  genTsGhjkFile,
  harness,
} from "./utils.ts";
import { stdSecureConfig } from "../mod.ts";
import dummy from "../ports/dummy.ts";
import type { DenoFileSecureConfig } from "../mod.ts";

type CustomE2eTestCase =
  & Omit<E2eTestCase, "ePoints" | "tsGhjkfileStr">
  & {
    ePoint: string;
    stdin: string;
  }
  & (
    | {
      envs: EnvDefArgs[];
      secureConfig?: DenoFileSecureConfig;
    }
    | {
      ghjkTs: string;
    }
  );

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
    inherit: false,
    vars: {
      HUMM: "Soul Lady",
    },
  },
];
const envVarTestsPosix = `
set -ex
# by default, we should be in main
[ "$SONG" = "ditto" ] || exit 101
[ "$GHJK_ENV" = "main" ] || exit 1011

ghjk envs cook sss
. .ghjk/envs/sss/activate.sh
# by default, envs should be based on main
# so they should inherit it's env vars
[ "$SONG" = "ditto" ] || exit 102
[ "$SING" = "Seoul Sonyo Sound" ] || exit 103
[ "$GHJK_ENV" = "sss" ] || exit 1012

# go back to main and "sss" variables shouldn't be around
. .ghjk/envs/main/activate.sh
[ "$SONG" = "ditto" ] || exit 104
[ "$SING" = "Seoul Sonyo Sound" ] && exit 105
[ "$GHJK_ENV" = "main" ] || exit 1013

# env base is false for "yuki" and thus no vars from "main"
ghjk envs cook yuki
. .ghjk/envs/yuki/activate.sh
[ "$SONG" = "ditto" ] && exit 102
[ "$HUMM" = "Soul Lady" ] || exit 103
[ "$GHJK_ENV" = "yuki" ] || exit 1014
`;
const envVarTestsFish = `
set fish_trace 1
# by default, we should be in main
test "$SONG" = "ditto"; or exit 101;
test "$GHJK_ENV" = "main"; or exit 1010;

ghjk envs cook sss
. .ghjk/envs/sss/activate.fish
# by default, envs should be based on main
# so they should inherit it's env vars
test "$SONG" = "ditto"; or exit 103
test "$SING" = "Seoul Sonyo Sound"; or exit 104
test "$GHJK_ENV" = "sss"; or exit 1011;

# go back to main and "sss" variables shouldn't be around
. .ghjk/envs/main/activate.fish
test $SONG" = "ditto"; or exit 105
test $SING" = "Seoul Sonyo Sound"; and exit 106
test "$GHJK_ENV" = "main"; or exit 1012;

# env base is false for "yuki" and thus no vars from "main"
ghjk envs cook yuki
. .ghjk/envs/yuki/activate.fish
test "$SONG" = "ditto"; and exit 107
test "$HUMM" = "Soul Lady"; or exit 108
test "$GHJK_ENV" = "yuki"; or exit 1013;
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
    inherit: false,
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
set fish_trace 1
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
  {
    name: "default_env_loader",
    ePoint: "fish",
    envs: envVarTestEnvs,
    secureConfig: stdSecureConfig({ defaultEnv: "yuki" }),
    stdin: `
set fish_trace 1
# env base is false for "yuki" and thus no vars from "main"
test "$GHJK_ENV" = "yuki"; or exit 106
test "$SONG" = "ditto"; and exit 107
test "$HUMM" = "Soul Lady"; or exit 108
`,
  },
];

harness(cases.map((testCase) => ({
  ...testCase,
  tsGhjkfileStr: "ghjkTs" in testCase ? testCase.ghjkTs : genTsGhjkFile(
    { envDefs: testCase.envs, secureConf: testCase.secureConfig },
  ),
  ePoints: [{ cmd: testCase.ePoint, stdin: testCase.stdin }],
  name: `envs/${testCase.name}`,
})));
