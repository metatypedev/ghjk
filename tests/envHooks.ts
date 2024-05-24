import "../setup_logger.ts";
import { E2eTestCase, harness } from "./utils.ts";

const posixInteractiveScript = `
set -eux
export GHJK_WD=$PWD

# hook creates a marker file
[ $(cat "$GHJK_WD/marker") = 'remark' ] || exit 101

pushd ../
# marker should be gone by now
[ ! -e "$GHJK_WD/marker" ] || exit 102

# cd back in
popd

# marker should be avail now
[ $(cat $GHJK_WD/marker) = 'remark' ] || exit 103
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
    .split("\n").map((line) =>
      `eval_PROMPT_COMMAND
${line}
`
    ),
]
  .join("\n");

const zshInteractiveScript = [
  // simulate interactive mode by evaluating precmd
  // before each line
  ...posixInteractiveScript
    .split("\n").map((line) =>
      `precmd
${line}
`
    ),
]
  .join("\n");

const posixNonInteractiveScript = `
set -eux

export GHJK_WD=$PWD

# test that ghjk_reload is avail because BASH_ENV exposed by the suite
ghjk_reload

# hook creates a marker file
[ $(cat "$GHJK_WD/marker") = 'remark' ] || exit 101

pushd ../
# no reload so it's stil avail
[ $(cat "$GHJK_WD/marker") = 'remark' ] || exit 102

ghjk_reload
# marker should be gone by now
[ ! -e "$GHJK_WD/marker" ] || exit 103

# cd back in
popd

# not avail yet
[ ! -e "$GHJK_WD/marker" ] || exit 104

ghjk_reload
# now it should be avail
[ $(cat "$GHJK_WD/marker") = 'remark' ] || exit 105
`;

const fishScript = `
set fish_trace 1
export GHJK_WD=$PWD

# hook creates a marker file
test (cat "$GHJK_WD/marker") = 'remark'; or exit 101

pushd ../
# marker should be gone by now
not test -e "$GHJK_WD/marker"; or exit 102

# cd back in
popd

# marker should be avail now
test (cat $GHJK_WD/marker) = 'remark'; or exit 103
`;

const fishInteractiveScript = [
  // simulate interactive mode by emitting postexec after each line
  // after each line
  ...fishScript
    .split("\n").flatMap((line) => [
      line,
      `emit fish_postexec`,
    ]),
]
  .join("\n");

const fishNonInteractiveScript = `
# test that ghjk_reload is avail because config.fish exposed by the suite
ghjk_reload

${fishScript}`;

type CustomE2eTestCase = Omit<E2eTestCase, "ePoints" | "tsGhjkfileStr"> & {
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
    ePoint: `fish -il`,
    stdin: fishInteractiveScript,
  },
  {
    name: "fish_scripting",
    ePoint: `fish`,
    // the fish implementation triggers changes
    // on any pwd changes so it's identical to
    // interactive usage
    stdin: fishNonInteractiveScript,
  },
];

harness(cases.map((testCase) => ({
  ...testCase,
  tsGhjkfileStr: `
export { ghjk } from "$ghjk/mod.ts";
import { task, env } from "$ghjk/mod.ts";

env("main")
  .onEnter(task($ => $\`/bin/sh -c 'echo remark > marker'\`))
  .onExit(task($ => $\`/bin/sh -c 'rm marker'\`))
`,
  ePoints: [{ cmd: testCase.ePoint, stdin: testCase.stdin }],
  name: `envHooks/${testCase.name}`,
})));
