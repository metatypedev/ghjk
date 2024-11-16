import "../setup_logger.ts";
import { E2eTestCase, genTsGhjkFile, harness } from "./utils.ts";
import dummy from "../ports/dummy.ts";
import type { InstallConfigFat } from "../port.ts";

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
[ "\${DUMMY_ENV:-}" = "dummy" ] && exit 103
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

# test that ghjk_hook doesn't run by default on non-interactive shells
# [ "\${DUMMY_ENV:-}" = "dummy" ] && exit 1011

# prepare DUMMY_ENV for restore check

DUMMY_ENV=old_dummy

# test that ghjk_hook is avail because BASH_ENV exposed by the suite
ghjk_hook
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

const fishNonInteractiveScript = `
set fish_trace 1
# test that ghjk_hook doesn't run by default on non-interactive shells
test $DUMMY_ENV = "dummy"; and exit 1011

set DUMMY_ENV old_dummy

# test that ghjk_hook is avail because config.fish exposed by the suite
ghjk_hook
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

// simulate interactive mode by emitting postexec after each line
// after each line. postexec isn't emitted by default on interactive
// fish shells
const fishInteractiveScript = `
set fish_trace 1
which dummy; or exit 101
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
  .map((line) => [
    line,
    `emit fish_preexec`,
  ])
  .join("\n");

type CustomE2eTestCase = Omit<E2eTestCase, "ePoints" | "tsGhjkfileStr"> & {
  installConf?: InstallConfigFat[];
  ePoint: string;
  stdin: string;
};

// -s: read from stdin
// -l: login mode
// -i: interactive mode
const bashInteractiveEpoint = Deno.env.get("GHJK_TEST_E2E_TYPE") == "local"
  ? `bash --rcfile $BASH_ENV -si` // we don't want to use the system rcfile
  : `bash -sil`;

const cases: CustomE2eTestCase[] = [
  {
    name: "bash_interactive_with_auto_hook",
    ePoint: bashInteractiveEpoint,
    stdin: posixInteractiveScript,
  },
  {
    name: "bash_interactive",
    ePoint: bashInteractiveEpoint,
    stdin: `
[ $(dummy) ] && exit 1020
[ "\${DUMMY_ENV:-}" = "dummy" ] && exit 1030
ghjk_hook` + posixInteractiveScript,
    envVars: {
      GHJK_AUTO_HOOK: "0",
    },
  },
  {
    name: "bash_scripting",
    ePoint: `bash -s`,
    stdin: posixNonInteractiveScript,
    envVars: {
      GHJK_AUTO_HOOK: "0",
    },
  },
  {
    name: "zsh_interactive_with_auto_hook",
    ePoint: `zsh -sli`,
    stdin: posixInteractiveScript
      .split("\n").filter((line) => !/^#/.test(line)).join("\n"),
  },
  {
    name: "zsh_interactive",
    ePoint: `zsh -sli`,
    stdin: `
[ $(dummy) ] && exit 1020
[ "\${DUMMY_ENV:-}" = "dummy" ] && exit 1030
ghjk_hook` + posixInteractiveScript,
    envVars: {
      GHJK_AUTO_HOOK: "0",
    },
  },
  {
    name: "zsh_scripting",
    ePoint: `zsh -s`,
    stdin: posixNonInteractiveScript,
    envVars: {
      GHJK_AUTO_HOOK: "0",
    },
  },
  {
    name: "fish_interactive_with_auto_hook",
    ePoint: `fish -il`,
    stdin: `set DUMMY_ENV old_dummy\n` +
      fishInteractiveScript,
  },
  {
    name: "fish_interactive",
    ePoint: `fish -il`,
    stdin: `set DUMMY_ENV old_dummy
which dummy; and exit 1030
test $DUMMY_ENV = "old_dummy"; or exit 1040
ghjk_hook
` + fishInteractiveScript,
    envVars: {
      GHJK_AUTO_HOOK: "0",
    },
  },
  {
    name: "fish_scripting",
    ePoint: `fish`,
    stdin: fishNonInteractiveScript,
    envVars: {
      GHJK_AUTO_HOOK: "0",
    },
  },
];

harness(cases.map((testCase) => ({
  ...testCase,
  tsGhjkfileStr: genTsGhjkFile(
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
  ePoints: [{ cmd: testCase.ePoint, stdin: testCase.stdin }],
  name: `reloadHooks/${testCase.name}`,
})));
