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
[ $(set +e; dummy) ] && exit 102
[ "$DUMMY_ENV" = "dummy" ] && exit 103

# cd back in
popd

# now it should be avail
dummy
[ "$DUMMY_ENV" = "dummy" ] || exit 106
`;

const bashInteractiveScript = [
  // simulate interactive mode by evaluating the prompt
  // before each line
  `
eval_PROMPT_COMMAND() {
  local prompt_command
  for prompt_command in "\${PROMPT_COMMAND[@]}"; do
    eval "$prompt_command"
  done
}
`,
  ...posixInteractiveScript
    .split("\n").flatMap((line) => [
      `eval_PROMPT_COMMAND`,
      line,
    ]),
]
  .join("\n");

const zshInteractiveScript = [
  // simulate interactive mode by evaluating precmd
  // before each line
  ...posixInteractiveScript
    .split("\n")
    .flatMap((line) => [`precmd`, line]),
]
  .join("\n");

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

type CustomE2eTestCase = Omit<E2eTestCase, "ePoints" | "tsGhjkfileStr"> & {
  installConf?: InstallConfigFat | InstallConfigFat[];
  ePoint: string;
  stdin: string;
};
const cases: CustomE2eTestCase[] = [
  {
    name: "bash_interactive",
    // -s: read from stdin
    // -l: login/interactive mode
    ePoint: `bash -sl`,
    stdin: bashInteractiveScript,
  },
  {
    name: "bash_scripting",
    ePoint: `bash -s`,
    stdin: posixNonInteractiveScript,
  },
  {
    name: "zsh_interactive",
    ePoint: `zsh -sl`,
    stdin: zshInteractiveScript,
  },
  {
    name: "zsh_scripting",
    ePoint: `zsh -s`,
    stdin: posixNonInteractiveScript,
  },
  {
    name: "fish_interactive",
    ePoint: `fish -l`,
    stdin: fishScript,
  },
  {
    name: "fish_scripting",
    ePoint: `fish`,
    // the fish implementation triggers changes
    // on any pwd changes so it's identical to
    // interactive usage
    stdin: fishScript,
  },
];

harness(cases.map((testCase) => ({
  ...testCase,
  tsGhjkfileStr: genTsGhjkFile(
    {
      installConf: testCase.installConf ?? dummy(),
      taskDefs: [],
      envDefs: [
        {
          name: "test",
        },
      ],
    },
  ),
  ePoints: [{ cmd: testCase.ePoint, stdin: testCase.stdin }],
  name: `reloadHooks/${testCase.name}`,
})));
