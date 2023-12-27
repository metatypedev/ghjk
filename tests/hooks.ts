import "../setup_logger.ts";
import { dockerE2eTest, E2eTestCase, localE2eTest } from "./utils.ts";
import dummy from "../ports/dummy.ts";

// avoid using single quotes in this script
const posixInteractiveScript = `
set -eux
[ "$DUMMY_ENV" = "dummy" ] || exit 101
dummy
pushd ../
# it shouldn't be avail here
[ $(set +e; dummy) ] && exit 102
# cd back in
popd
# now it should be avail
dummy
`;

// avoid using single quotes in this script
const posixNonInteractiveScript = `
set -eux
# test that ghjk_reload is avail because BASH_ENV exposed by the suite
ghjk_reload
[ "$DUMMY_ENV" = "dummy" ] || exit 101
dummy
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
[ $(set +e;  dummy) ] && exit 104
[ "$DUMMY_ENV" = "dummy" ] && exit 105
ghjk_reload
# now it should be avail
dummy
[ "$DUMMY_ENV" = "dummy" ] || exit 106
`;

const fishScript = `
dummy; or exit 101
test $DUMMY_ENV = "dummy"; or exit 102
pushd ../
# it shouldn't be avail here
dummy; and exit 103
test $DUMMY_ENV = "dummy"; and exit 104
# cd back in
popd
# now it should be avail
dummy; or exit 123
test $DUMMY_ENV = "dummy"; or exit 105
`;

type CustomE2eTestCase = Omit<E2eTestCase, "ePoints"> & {
  ePoint: string;
  stdin: string;
};
const cases: CustomE2eTestCase[] = [
  {
    installConf: dummy(),
    name: "hook_test_bash_interactive",
    // -s: read from stdin
    // -l: login/interactive mode
    ePoint: `bash -sl`,
    stdin: posixInteractiveScript,
  },
  {
    installConf: dummy(),
    name: "hook_test_bash_scripting",
    ePoint: `bash -s`,
    stdin: posixNonInteractiveScript,
  },
  {
    installConf: dummy(),
    name: "hook_test_zsh_interactive",
    ePoint: `zsh -sl`,
    stdin: posixInteractiveScript,
  },
  {
    installConf: dummy(),
    name: "hook_test_zsh_scripting",
    ePoint: `zsh -s`,
    stdin: posixNonInteractiveScript,
  },
  {
    installConf: dummy(),
    name: "hook_test_fish_interactive",
    ePoint: `fish -l`,
    stdin: fishScript,
  },
  {
    installConf: dummy(),
    name: "hook_test_fish_scripting",
    ePoint: `fish`,
    // the fish implementation triggers changes
    // on any pwd changes so it's identical to
    // interactive usage
    stdin: fishScript,
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
          ePoints: [{ cmd: testCase.ePoint, stdin: testCase.stdin }],
          envs: {
            ...defaultEnvs,
            ...testCase.envs,
          },
        }),
    );
  }
}

const e2eType = Deno.env.get("GHJK_TEST_E2E_TYPE");
if (e2eType == "both") {
  testMany("hooksDockerE2eTest", cases, dockerE2eTest);
  testMany(`hooksLocalE2eTest`, cases, localE2eTest);
} else if (e2eType == "local") {
  testMany("hooksLocalE2eTest", cases, localE2eTest);
} else if (
  e2eType == "docker" ||
  !e2eType
) {
  testMany("hooksDockerE2eTest", cases, dockerE2eTest);
} else {
  throw new Error(
    `unexpected GHJK_TEST_E2E_TYPE: ${e2eType}`,
  );
}
