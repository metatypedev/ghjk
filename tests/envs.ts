import "../src/deno_utils/setup_logger.ts";
import {
  E2eTestCase,
  type EnvDefArgs,
  genTsGhjkFile,
  harness,
} from "./utils.ts";
import dummy from "../ports/dummy.ts";
import type { FileArgs } from "../src/ghjk_ts/mod.ts";

type CustomE2eTestCase =
  & Omit<E2eTestCase, "ePoints" | "fs">
  & {
    ePoint: string;
    stdin: string;
  }
  & (
    | {
      envs: EnvDefArgs[];
      secureConfig?: FileArgs;
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
env
# by default, we should be in main
[ "$SONG" = "ditto" ] || exit 1010
[ "$GHJK_ENV" = "main" ] || exit 1011

# vars should be gone after deactivation
ghjk_deactivate
[ "$SONG" = "ditto" ] && exit 1022
[ "$GHJK_ENV" = "main" ] && exit 1022

ghjk envs cook sss
echo $?
. .ghjk/envs/sss/activate.sh
# by default, envs should be based on main
# so they should inherit it's env vars
[ "$SONG" = "ditto" ] || exit 102
[ "$SING" = "Seoul Sonyo Sound" ] || exit 103
[ "$GHJK_ENV" = "sss" ] || exit 1012

# go back to main and "sss" variables shouldn't be around
# through deactivation
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

# vars should be gone after deactivation
ghjk_deactivate
test "$SONG" = "ditto"; and exit 101;
test "$GHJK_ENV" = "main"; and exit 1010;

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

const taskAliasTestBody = {
  posix: `
set -ex
ghjk envs cook main
. .ghjk/envs/main/activate.sh
greet world
test "$(greet world)" = "Hello world!" || exit 101
type greet || exit 102
ghjk_deactivate
# alias should be gone after deactivation
type greet && exit 103
[ $? -eq 1 ] || exit 104
`,
  fish: `
set fish_trace 1
ghjk envs cook main
. .ghjk/envs/main/activate.fish
greet world
test (greet world) = "Hello world!"; or exit 101
type greet; or exit 102
ghjk_deactivate
# alias should be gone after deactivation
type -q greet; and exit 103
test $status = 1; or exit 104
`,
};

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
    ePoint: `bash -s`,
    envs: installTestEnvs,
    stdin: installTestsPosix,
  },
  {
    name: "prov_port_installs_zsh",
    ePoint: `zsh -s`,
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
    secureConfig: { defaultEnv: "yuki" },
    stdin: `
set fish_trace 1

# env base is false for "yuki" and thus no vars from "main"
test "$GHJK_ENV" = "yuki"; or exit 106
test "$SONG" = "ditto"; and exit 107
test "$HUMM" = "Soul Lady"; or exit 108
`,
  },
  {
    name: "env_inherit_from_envs",
    ePoint: "fish",
    envs: [],
    secureConfig: {
      defaultEnv: "e1",
      envs: [
        { name: "e1", inherit: "e2" },
        {
          name: "e2",
          vars: { HEY: "hello" },
        },
      ],
    },
    stdin: `
set fish_trace 1
test "$GHJK_ENV" = "e1"; or exit 101
test "$HEY" = "hello"; or exit 102
`,
  },
  {
    name: "task_inherit_from_envs",
    ePoint: "fish",
    envs: [],
    secureConfig: {
      envs: [{ name: "e1", vars: { HEY: "hello" } }],
      tasks: { t1: { inherit: "e1", fn: ($) => $`echo $HEY` } },
    },
    stdin: `
set fish_trace 1
test (ghjk x t1) = "hello"; or exit 102
`,
  },
  {
    name: "env_inherit_from_tasks",
    ePoint: "fish",
    envs: [],
    secureConfig: {
      defaultEnv: "e1",
      envs: [{ name: "e1", inherit: "t1" }],
      tasks: { t1: { vars: { HEY: "hello" } } },
    },
    stdin: `
set fish_trace 1
test "$GHJK_ENV" = "e1"; or exit 101
test "$HEY" = "hello"; or exit 102
`,
  },
  {
    name: "task_inherit_from_task",
    ePoint: "fish",
    envs: [],
    secureConfig: {
      tasks: {
        t1: { vars: { HEY: "hello" }, fn: ($) => $`echo fake` },
        t2: {
          inherit: "t1",
          fn: ($) => $`echo $HEY`,
        },
      },
    },
    stdin: `
set fish_trace 1
test (ghjk x t2) = "hello"; or exit 102
`,
  },
  {
    name: "hereditary",
    ePoint: "fish",
    envs: [
      { name: "e1", vars: { E1: "1" }, installs: [dummy({ output: "e1" })] },
      {
        name: "e2",
        inherit: "e1",
        vars: { E2: "2" },
      },
      {
        name: "e3",
        inherit: "e2",
        vars: { E3: "3" },
      },
    ],
    stdin: `
set fish_trace 1
ghjk envs cook e3
. .ghjk/envs/e3/activate.fish
test "$E1" = "1"; or exit 101
test "$E2" = "2"; or exit 102
test "$E3" = "3"; or exit 103
test (dummy) = "e1"; or exit 104
`, // TODO: test inheritance of more props
  },
  {
    name: "inheritance_diamond",
    ePoint: "fish",
    envs: [
      { name: "e1", vars: { E1: "1" }, installs: [dummy({ output: "e1" })] },
      {
        name: "e2",
        inherit: "e1",
        vars: { E2: "2" },
      },
      {
        name: "e3",
        inherit: "e1",
        vars: { E3: "3" },
      },
      {
        name: "e4",
        inherit: ["e2", "e3"],
        vars: { E4: "4" },
      },
    ],
    stdin: `
set fish_trace 1
ghjk envs cook e4
. .ghjk/envs/e4/activate.fish
test "$E1" = "1"; or exit 101
test "$E2" = "2"; or exit 102
test "$E3" = "3"; or exit 103
test "$E4" = "4"; or exit 104
test (dummy) = "e1"; or exit 105
`, // TODO: test inheritance of more props
  },
  {
    name: "task_aliases_bash",
    ePoint: `bash -s`,
    envs: [],
    secureConfig: {
      tasks: {
        greet: {
          fn: ($, { argv: [name] }) => $`echo Hello ${name}!`,
        },
      },
    },
    stdin: taskAliasTestBody.posix,
  },
  {
    name: "task_aliases_zsh",
    ePoint: `zsh -s`,
    envs: [],
    secureConfig: {
      tasks: {
        greet: {
          fn: ($, { argv: [name] }) => $`echo Hello ${name}!`,
        },
      },
    },
    stdin: taskAliasTestBody.posix,
  },
  {
    name: "task_aliases_fish",
    ePoint: `fish`,
    envs: [],
    secureConfig: {
      tasks: {
        greet: {
          fn: ($, { argv: [name] }) => $`echo Hello ${name}!`,
        },
      },
    },
    stdin: taskAliasTestBody.fish,
  },
];

harness(cases.map((testCase) => ({
  ...testCase,
  fs: {
    "ghjk.ts": "ghjkTs" in testCase ? testCase.ghjkTs : genTsGhjkFile(
      {
        secureConf: {
          ...testCase.secureConfig,
          envs: [...testCase.envs, ...(testCase.secureConfig?.envs ?? [])],
        },
      },
    ),
  },
  ePoints: [{ cmd: testCase.ePoint, stdin: testCase.stdin }],
  name: `envs/${testCase.name}`,
})));
