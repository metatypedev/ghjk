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
import { stdSecureConfig } from "../ghjkfiles/mod.ts";

type CustomE2eTestCase = Omit<E2eTestCase, "ePoints" | "tsGhjkfileStr"> & {
  ePoint: string;
  stdin: string;
  tasks: TaskDefArgs[];
  enableRuntimesOnMasterPDAL?: boolean;
};
const cases: CustomE2eTestCase[] = [
  {
    name: "base",
    tasks: [{
      name: "greet",
      fn: async ({ $, argv: [name] }) => {
        await $`echo Hello ${name}!`;
      },
    }],
    ePoint: `fish`,
    stdin: `
cat ghjk.ts
test (ghjk x greet world) = 'Hello world!'`,
  },
  {
    name: "env_vars",
    tasks: [{
      name: "greet",
      envVars: {
        NAME: "moon",
      },
      fn: async ({ $ }) => {
        await $`echo Hello $NAME!`;
      },
    }],
    ePoint: `fish`,
    stdin: `
cat ghjk.ts
test (ghjk x greet world) = 'Hello moon!'`,
  },
  {
    name: "ports",
    tasks: [{
      name: "protoc",
      installs: [ports.protoc()],
      fn: async ({ $ }) => {
        await $`protoc --version`;
      },
    }],
    ePoint: `fish`,
    stdin: `
ghjk x protoc`,
  },
  {
    name: "port_deps",
    tasks: [{
      name: "test",
      // node depends on tar_aa
      installs: [...ports.pipi({ packageName: "pre-commit" })],
      allowedPortDeps: ghjk.stdDeps({ enableRuntimes: true }),
      fn: async ({ $ }) => {
        await $`pre-commit --version`;
      },
    }],
    ePoint: `fish`,
    stdin: `ghjk x test`,
    enableRuntimesOnMasterPDAL: true,
  },
  {
    name: "default_port_deps",
    tasks: [{
      name: "test",
      // node depends on tar_aa
      installs: [ports.node()],
      fn: async ({ $ }) => {
        await $`node --version`;
      },
    }],
    ePoint: `fish`,
    stdin: `ghjk x test`,
  },
  {
    name: "dependencies",
    tasks: [
      {
        name: "ed",
        dependsOn: [],
        fn: async ({ $ }) => {
          await $`/bin/sh -c 'echo ed > ed'`;
        },
      },
      {
        name: "edd",
        dependsOn: ["ed"],
        fn: async ({ $ }) => {
          await $`/bin/sh -c 'echo $(/bin/cat ed) edd > edd'`;
        },
      },
      {
        name: "eddy",
        dependsOn: ["edd"],
        fn: async ({ $ }) => {
          await $`/bin/sh -c 'echo $(/bin/cat edd) eddy > eddy'`;
        },
      },
    ],
    ePoint: `fish`,
    stdin: `
ghjk x eddy
test (cat eddy) = 'ed edd eddy'
`,
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
            {
              taskDefs: testCase.tasks,
              secureConf: stdSecureConfig({
                enableRuntimes: testCase.enableRuntimesOnMasterPDAL,
              }),
            },
          ),
          ePoints: [{ cmd: testCase.ePoint, stdin: testCase.stdin }],
          envVars: {
            ...defaultEnvs,
            ...testCase.envVars,
          },
        }),
    );
  }
}

const e2eType = Deno.env.get("GHJK_TEST_E2E_TYPE");
if (e2eType == "both") {
  testMany("tasksDockerE2eTest", cases, dockerE2eTest);
  testMany(`tasksLocalE2eTest`, cases, localE2eTest);
} else if (e2eType == "local") {
  testMany("tasksLocalE2eTest", cases, localE2eTest);
} else if (
  e2eType == "docker" ||
  !e2eType
) {
  testMany("tasksDockerE2eTest", cases, dockerE2eTest);
} else {
  throw new Error(
    `unexpected GHJK_TEST_E2E_TYPE: ${e2eType}`,
  );
}
