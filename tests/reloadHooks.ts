import "../setup_logger.ts";
import { E2eTestCase, genTsGhjkFile, harness } from "./utils.ts";
import dummy from "../ports/dummy.ts";
import type { InstallConfigFat } from "../port.ts";

// TODO: test for hook reload when ghjk.ts is touched
// TODO: test for hook reload when nextfile is touched

const posixInteractiveScript = `
set -eux
[ "$DUMMY_ENV" = "dummy" ] || exit 101
dummy

# it should be avail in subshells
sh -c '[ "$DUMMY_ENV" = "dummy" ]' || exit 105
sh -c "dummy"

pushd ../
# it shouldn't be avail here
set +ex
[ $(dummy) ] && exit 102
[ "$DUMMY_ENV" = "dummy" ] && exit 103
set -ex

# cd back in
popd

# now it should be avail
dummy
[ "$DUMMY_ENV" = "dummy" ] || exit 106

[ "$GHJK_ENV" = "main" ] || exit 107
ghjk e cook test
echo "test" > $GHJK_NEXTFILE
[ "$GHJK_ENV" = "test" ] || exit 108
`;

const posixNonInteractiveScript = `
set -eux

# test that ghjk_reload is avail because BASH_ENV exposed by the suite
ghjk_reload
[ "$DUMMY_ENV" = "dummy" ] || exit 101
dummy

# it should be avail in subshells
sh -c '[ "$DUMMY_ENV" = "dummy" ]' || exit 105
sh -c "dummy"

pushd ../
# no reload so it's stil avail
dummy
ghjk_reload

# it shouldn't be avail now
[ $(set +e; dummy) ] && exit 102
[ "$DUMMY_ENV" = "dummy" ] && exit 103

# cd back in
popd

# not avail yet
[ $(set +e; dummy) ] && exit 104
[ "$DUMMY_ENV" = "dummy" ] && exit 105

ghjk_reload
# now it should be avail
dummy
[ "$DUMMY_ENV" = "dummy" ] || exit 106

[ "$GHJK_ENV" = "main" ] || exit 107
ghjk e cook test

ghjk_reload test
[ "$GHJK_ENV" = "test" ] || exit 110
ghjk_reload
[ "$GHJK_ENV" = "test" ] || exit 111

GHJK_ENV=test ghjk_reload
[ "$GHJK_ENV" = "test" ] || exit 112
`;

const fishScript = `
set fish_trace 1
dummy; or exit 101
test $DUMMY_ENV = "dummy"; or exit 102

# it should be avail in subshells
sh -c '[ "$DUMMY_ENV" = "dummy" ]'; or exit 105
sh -c "dummy"

pushd ../
# it shouldn't be avail here
which dummy; and exit 103
test $DUMMY_ENV = "dummy"; and exit 104

# cd back in
popd
# now it should be avail
dummy; or exit 123
test $DUMMY_ENV = "dummy"; or exit 105
`;

const fishNoninteractiveScript = `
set fish_trace 1
# test that ghjk_reload is avail because config.fish exposed by the suite
ghjk_reload

${fishScript}

# must cook test first
ghjk envs cook test

test $GHJK_ENV = "main"; or exit 107

# manually switch to test
ghjk_reload test
test "$GHJK_ENV" = "test"; or exit 108

# re-invoking reload won't go back to main
ghjk_reload
test "$GHJK_ENV" = "test"; or exit 109

# go back to main
ghjk_reload main
test "$GHJK_ENV" = "main"; or exit 111

# changing GHJK_ENV manually gets respected
GHJK_ENV=test ghjk_reload
test "$GHJK_ENV" = "test"; or exit 112`;

const fishInteractiveScript = [
  fishScript,
  // simulate interactive mode by emitting postexec after each line
  // after each line
  ...`
ghjk e cook test
test $GHJK_ENV = "main"; or exit 107

echo "test" > $GHJK_NEXTFILE
test "$GHJK_ENV" = "test"; or exit 108

ghjk_reload main
test "$GHJK_ENV" = "main"; or exit 111

GHJK_ENV=test ghjk_reload
test "$GHJK_ENV" = "test"; or exit 112
`
    .split("\n").flatMap((line) => [
      line,
      `emit fish_preexec`,
    ]),
]
  .join("\n");

type CustomE2eTestCase = Omit<E2eTestCase, "ePoints" | "tsGhjkfileStr"> & {
  installConf?: InstallConfigFat[];
  ePoint: string;
  stdin: string;
};
const cases: CustomE2eTestCase[] = [
  {
    name: "bash_interactive",
    // -s: read from stdin
    // -l: login mode
    // -i: interactive mode
    ePoint: `bash -sli`,
    stdin: posixInteractiveScript,
  },
  {
    name: "bash_scripting",
    ePoint: `bash -s`,
    stdin: posixNonInteractiveScript,
  },
  {
    name: "zsh_interactive",
    ePoint: `zsh -sli`,
    stdin: posixInteractiveScript
      .split("\n").filter((line) => !/^#/.test(line)).join("\n"),
  },
  {
    name: "zsh_scripting",
    ePoint: `zsh -s`,
    stdin: posixNonInteractiveScript,
  },
  {
    name: "fish_interactive",
    ePoint: `fish -il`,
    stdin: fishInteractiveScript,
  },
  {
    name: "fish_scripting",
    ePoint: `fish`,
    // the fish implementation triggers changes
    // on any pwd changes so it's identical to
    // interactive usage
    stdin: fishNoninteractiveScript,
  },
];

harness(cases.map((testCase) => ({
  ...testCase,
  tsGhjkfileStr: genTsGhjkFile(
    {
      envDefs: [
        {
          name: "main",
          installs: testCase.installConf ? testCase.installConf : [dummy()],
        },
        {
          name: "test",
        },
      ],
    },
  ),
  ePoints: [{ cmd: testCase.ePoint, stdin: testCase.stdin }],
  name: `reloadHooks/${testCase.name}`,
})));
