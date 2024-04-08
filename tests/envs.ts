import "../setup_logger.ts";
import {
  dockerE2eTest,
  E2eTestCase,
  genTsGhjkFile,
  localE2eTest,
  type TaskDefArgs,
} from "./utils.ts";
import * as ghjk from "../mod.ts";
import * as ports from "../ports/mod.ts";

type CustomE2eTestCase = Omit<E2eTestCase, "ePoints" | "tsGhjkfileStr"> & {
  ePoint: string;
  stdin: string;
};
const cases: CustomE2eTestCase[] = [
  {
    name: "base",
    ePoint: `fish`,
    stdin: `
cat ghjk.ts
test (ghjk x greet world) = 'Hello world!'`,
  },
  {
    name: "env_vars",
    ePoint: `fish`,
    stdin: `
cat ghjk.ts
test (ghjk x greet world) = 'Hello moon!'`,
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
            { installConf: [], taskDefs: [] },
          ),
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
