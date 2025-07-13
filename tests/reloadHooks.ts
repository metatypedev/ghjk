import "../src/deno_utils/setup_logger.ts";
import { E2eTestCase, genTsGhjkFile, harness } from "./utils.ts";
import dummy from "../ports/dummy.ts";
import { type InstallConfigFat } from "../src/deno_ports/mod.ts";

// TODO: test for hook reload when ghjk.ts is touched
// TODO: test for hook reload when nextfile is touched

const posixInteractiveScript = `
set -ex
[ "\${DUMMY_ENV:-}" = "dummy" ] || exit 101
dummy

# it should be avail in subshells
sh -c '[ "\${DUMMY_ENV:-}" = "dummy" ]' || exit 105
sh -c "dummy"

pushd ../
# it shouldn't be avail here
set +ex
[ $(dummy) ] && exit 102
[ "\${DUMMY_ENV:-}" = "old_dummy" ] || exit 103
set -ex

# cd back in
popd

# now it should be avail
dummy
[ "\${DUMMY_ENV:-}" = "dummy" ] || exit 106

[ "\${GHJK_ENV:-}" = "main" ] || exit 107
ghjk e cook test
echo "test" > $GHJK_NEXTFILE
[ "\${GHJK_ENV:-}" = "test" ] || exit 108
`;

const posixNonInteractiveScript = `
set -eux

# items should be avail on new shell
# either due to auto hook and BASH_ENV/ZDOTDIR
[ "\${DUMMY_ENV:-}" = "dummy" ] || exit 101
dummy

# it should be avail in subshells
sh -c '[ "\${DUMMY_ENV:-}" = "dummy" ]' || exit 105
sh -c "dummy"

pushd ../
# no reload so it's stil avail
dummy
ghjk_hook

# it shouldn't be avail now
[ $(set +e; dummy) ] && exit 102
[ "\${DUMMY_ENV:-}" = "old_dummy" ] || exit 103

# cd back in
popd

# not avail yet
[ $(set +e; dummy) ] && exit 104
[ "\${DUMMY_ENV:-}" = "old_dummy" ] || exit 105

ghjk_hook
# now it should be avail
dummy
[ "\${DUMMY_ENV:-}" = "dummy" ] || exit 106

[ "\${GHJK_ENV}" = "main" ] || exit 107
ghjk e cook test

ghjk_hook test
[ "\${GHJK_ENV:-}" = "test" ] || exit 110
ghjk_hook
[ "\${GHJK_ENV:-}" = "test" ] || exit 111

GHJK_ENV=test ghjk_hook
[ "\${GHJK_ENV:-}" = "test" ] || exit 112
`;

// assumes BASH_ENV/ZDOTDIR
const posixNonInteractiveScriptNoHook = `set -eux
# test that ghjk_hook doesn't run by default on non-interactive shells
[ $(set +e; dummy) ] && exit 1021
# [ "\${DUMMY_ENV:-}" = "dummy" ] && exit 1011

# test that ghjk_hook is avail because BASH_ENV exposed by the suite
ghjk_hook
` + posixNonInteractiveScript;

const fishNonInteractiveScript = `
set fish_trace 1

# items should be avail on new shell
# either due to auto hook or custom code down below
which dummy; or exit 101
test $DUMMY_ENV = "dummy"; or exit 102

# it should be avail in subshells
sh -c '[ "$DUMMY_ENV" = "dummy" ]'; or exit 105
sh -c "dummy"

pushd ../
# no reload so it's stil avail
which dummy; or exit 1012
test $DUMMY_ENV = "dummy"; or exit 1022

ghjk_hook
# it shouldn't be avail now
which dummy; and exit 103
test $DUMMY_ENV = "old_dummy"; or exit 104

# cd back in
popd
# not avail yet
which dummy; and exit 103
test $DUMMY_ENV = "old_dummy"; or exit 104

ghjk_hook
# now it should be avail
dummy; or exit 123
test $DUMMY_ENV = "dummy"; or exit 105

# must cook test first
ghjk envs cook test

test $GHJK_ENV = "main"; or exit 107

# manually switch to test
ghjk_hook test
test "$GHJK_ENV" = "test"; or exit 108

# re-invoking reload won't go back to main
ghjk_hook
test "$GHJK_ENV" = "test"; or exit 109

# go back to main
ghjk_hook main
test "$GHJK_ENV" = "main"; or exit 111

# changing GHJK_ENV manually gets respected
GHJK_ENV=test ghjk_hook
test "$GHJK_ENV" = "test"; or exit 112`;

const fishNonInteractiveScriptNoHook = `
set fish_trace 1

# test that ghjk_hook doesn't run by default on non-interactive shells
which dummy; and exit 1030
test $DUMMY_ENV = "dummy"; and exit 1011

# test that ghjk_hook is avail because config.fish exposed by the suite
# simulate auto hook so that we can re-use test
ghjk_hook
` + fishNonInteractiveScript;

// simulate interactive mode by emitting postexec after each line
// after each line. postexec isn't emitted by default on interactive
// fish shells
const fishInteractiveScript = `
set fish_trace 1
which dummy; or exit 101
env
test $DUMMY_ENV = "dummy"; or exit 102

# it should be avail in subshells
sh -c '[ "$DUMMY_ENV" = "dummy" ]'; or exit 105
sh -c "dummy"

pushd ../
# it shouldn't be avail here
which dummy; and exit 103
test $DUMMY_ENV = "old_dummy"; or exit 104

# cd back in
popd
# now it should be avail
dummy; or exit 123
test $DUMMY_ENV = "dummy"; or exit 105

ghjk e cook test
test $GHJK_ENV = "main"; or exit 107

echo "test" > $GHJK_NEXTFILE
test "$GHJK_ENV" = "test"; or exit 108

ghjk_hook main
test "$GHJK_ENV" = "main"; or exit 111

GHJK_ENV=test ghjk_hook
test "$GHJK_ENV" = "test"; or exit 112
`
  .split("\n")
  .flatMap((line) => [
    line,
    `emit fish_preexec;`,
  ])
  .join("\n");

type CustomE2eTestCase = Omit<E2eTestCase, "ePoints" | "fs"> & {
  installConf?: InstallConfigFat[];
  ePoint: string;
  stdin: string;
};

// -s: read from stdin
// -l: login mode
// -i: interactive mode
// we don't want to use the system rcfile
const bashInteractiveEpoint = `bash --rcfile "$BASH_ENV" -si`;

const cases: CustomE2eTestCase[] = [
  {
    name: "bash_interactive",
    ePoint: bashInteractiveEpoint,
    stdin: posixInteractiveScript,
    envVars: {
      DUMMY_ENV: "old_dummy",
    },
  },
  {
    name: "bash_scripting",
    ePoint: `bash -s`,
    stdin: posixNonInteractiveScriptNoHook,
    envVars: {
      GHJK_AUTO_HOOK: "0",
      DUMMY_ENV: "old_dummy",
    },
  },
  {
    // assumes BASH_ENV or ZDOTDIR are set
    // for ghjk with GHJK_AUTO_HOOK set to 1
    name: "bash_scripting_with_auto_hook",
    ePoint: `bash -s`,
    stdin: posixNonInteractiveScript,
    envVars: {
      DUMMY_ENV: "old_dummy",
    },
  },
  {
    name: "zsh_interactive",
    ePoint: `zsh -sli`,
    stdin: posixInteractiveScript
      .split("\n").filter((line) => !/^#/.test(line)).join("\n"),
    envVars: {
      DUMMY_ENV: "old_dummy",
    },
  },
  {
    name: "zsh_scripting",
    ePoint: `zsh -s`,
    stdin: posixNonInteractiveScriptNoHook,
    envVars: {
      GHJK_AUTO_HOOK: "0",
      DUMMY_ENV: "old_dummy",
    },
  },
  {
    // assumes BASH_ENV or ZDOTDIR are set
    // for ghjk with GHJK_AUTO_HOOK set to 1
    name: "zsh_scripting_with_auto_hook",
    ePoint: `zsh -s`,
    stdin: posixNonInteractiveScript,
    envVars: {
      DUMMY_ENV: "old_dummy",
    },
  },
  {
    name: "fish_interactive",
    ePoint: `fish -il`,
    stdin: fishInteractiveScript,
    envVars: {
      DUMMY_ENV: "old_dummy",
    },
  },
  {
    name: "fish_scripting",
    ePoint: `fish`,
    stdin: fishNonInteractiveScriptNoHook,
    envVars: {
      GHJK_AUTO_HOOK: "0",
      DUMMY_ENV: "old_dummy",
    },
  },
  {
    name: "fish_scripting_with_auto_hook",
    ePoint: `fish`,
    stdin: fishNonInteractiveScript,
    envVars: {
      DUMMY_ENV: "old_dummy",
    },
  },
];

harness(cases.map((testCase) => ({
  ...testCase,
  fs: {
    "ghjk.ts": genTsGhjkFile(
      {
        secureConf: {
          envs: [
            {
              name: "main",
              installs: testCase.installConf ? testCase.installConf : [dummy()],
            },
            {
              name: "test",
            },
          ],
        },
      },
    ),
  },
  ePoints: [{ cmd: testCase.ePoint, stdin: testCase.stdin }],
  name: `reloadHooks/${testCase.name}`,
})));
