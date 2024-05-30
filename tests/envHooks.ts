import "../setup_logger.ts";
import { E2eTestCase, harness } from "./utils.ts";

const posixInteractiveScript = `
set -eux
export GHJK_WD=$PWD

# hook creates a marker file
[ "$GHJK_ENV" = 'main' ] || exit 111
[ $(cat "$GHJK_WD/marker") = 'remark' ] || exit 101

pushd ../
# marker should be gone by now
[ ! -e "$GHJK_WD/marker" ] || exit 102

# cd back in
popd

# marker should be avail now
[ $(cat $GHJK_WD/marker) = 'remark' ] || exit 103
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
  // simulate interactive mode by emitting prexec after each line
  // after each line
  ...fishScript
    .split("\n").flatMap((line) => [
      line,
      `emit fish_preexec`,
    ]),
]
  .join("\n");

type CustomE2eTestCase = Omit<E2eTestCase, "ePoints" | "tsGhjkfileStr"> & {
  ePoint: string;
  stdin: string;
};
const cases: CustomE2eTestCase[] = [
  {
    name: "bash_interactive",
    // -s: read from stdin
    // -l: login mode
    // -i: make it interactive
    ePoint: Deno.env.get("GHJK_TEST_E2E_TYPE") == "local"
      ? `bash --rcfile $BASH_ENV -si` // we don't want to use the system rcfile
      : `bash -sil`,
    stdin: posixInteractiveScript,
  },
  {
    name: "zsh_interactive",
    ePoint: `zsh -sil`,
    stdin: posixInteractiveScript
      .split("\n").filter((line) => !/^#/.test(line)).join("\n"),
  },
  {
    name: "fish_interactive",
    ePoint: `fish -il`,
    stdin: fishInteractiveScript,
  },
];

harness(cases.map((testCase) => ({
  ...testCase,
  tsGhjkfileStr: `
export { sophon } from "$ghjk/hack.ts";
import { task, env } from "$ghjk/hack.ts";

env("main")
  .onEnter(task($ => $\`/bin/sh -c 'echo remark > marker'\`))
  .onExit(task($ => $\`/bin/sh -c 'rm marker'\`))
`,
  ePoints: [{ cmd: testCase.ePoint, stdin: testCase.stdin }],
  name: `envHooks/${testCase.name}`,
})));
