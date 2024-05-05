import "../setup_logger.ts";
import {
  dockerE2eTest,
  E2eTestCase,
  genTsGhjkFile,
  localE2eTest,
  type TaskDef,
} from "./utils.ts";
import * as ghjk from "../mod.ts";
import * as ports from "../ports/mod.ts";
import { stdSecureConfig } from "../files/mod.ts";

type CustomE2eTestCase =
  & Omit<E2eTestCase, "ePoints" | "tsGhjkfileStr">
  & {
    ePoint: string;
    stdin: string;
    enableRuntimesOnMasterPDAL?: boolean;
  }
  & (
    | {
      tasks: TaskDef[];
    }
    | {
      ghjk_ts: string;
    }
  );
const cases: CustomE2eTestCase[] = [
  {
    name: "base",
    tasks: [{
      name: "greet",
      fn: async ($, { argv: [name], workingDir }) => {
        await $`echo Hello ${name} from ${workingDir}!`;
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
      async fn($) {
        await $`echo Hello $NAME!`;
        await $`echo Hello ${$.env["NAME"]!}!`;
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
      async fn($) {
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
      // pipi depends on cpy_bs
      installs: [...ports.pipi({ packageName: "pre-commit" })],
      allowedPortDeps: ghjk.stdDeps({ enableRuntimes: true }),
      async fn($) {
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
      async fn($) {
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
        async fn($) {
          await $`/bin/sh -c 'echo ed > ed'`;
        },
      },
      {
        name: "edd",
        dependsOn: ["ed"],
        async fn($) {
          await $`/bin/sh -c 'echo $(/bin/cat ed) edd > edd'`;
        },
      },
      {
        name: "eddy",
        dependsOn: ["edd"],
        async fn($) {
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
  {
    name: "anon tasks",
    ghjk_ts: `
export { ghjk } from "$ghjk/mod.ts";
import { task } from "$ghjk/mod.ts";

task({
  dependsOn: [
    task({
      dependsOn: [
        task(($) => $\`/bin/sh -c 'echo ed > ed'\`),
      ],
      fn: ($) => $\`/bin/sh -c 'echo $(/bin/cat ed) edd > edd'\`,
    }),
  ],
  name: "eddy",
  fn: ($) => $\`/bin/sh -c 'echo $(/bin/cat edd) eddy > eddy'\`    
});
`,
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
          tsGhjkfileStr: "ghjk_ts" in testCase
            ? testCase.ghjk_ts
            : genTsGhjkFile(
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
