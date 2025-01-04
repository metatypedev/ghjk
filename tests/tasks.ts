import "../setup_logger.ts";
import { E2eTestCase, genTsGhjkFile, harness, type TaskDef } from "./utils.ts";
import * as ghjk from "../mod.ts";
import * as ports from "../ports/mod.ts";

type CustomE2eTestCase =
  & Omit<E2eTestCase, "ePoints" | "fs">
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
      ghjkTs: string;
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
test (ghjk x greet world) = "Hello world from $PWD!"`,
  },
  {
    name: "env_vars",
    tasks: [{
      name: "greet",
      vars: {
        LUNA: "moon",
        SOL: "sun",
      },
      fn: async ($) => {
        await $`echo "Hello $SOL & ${$.env["LUNA"]!}"!`;
      },
    }],
    ePoint: `fish`,
    stdin: `
test (ghjk x greet world) = 'Hello sun & moon!'`,
  },
  {
    name: "ports",
    tasks: [{
      name: "protoc",
      installs: [ports.protoc()],
      fn: async ($) => {
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
      allowedBuildDeps: ghjk.stdDeps({ enableRuntimes: true }),
      fn: async ($) => {
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
      fn: async ($) => {
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
        fn: async ($) => {
          await $`/bin/sh -c 'echo ed > ed'`;
        },
      },
      {
        name: "edd",
        dependsOn: ["ed"],
        fn: async ($) => {
          await $`/bin/sh -c 'echo $(/bin/cat ed) edd > edd'`;
        },
      },
      {
        name: "eddy",
        dependsOn: ["edd"],
        fn: async ($) => {
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
    name: "anon",
    ghjkTs: `
export { ghjk } from "$ghjk/hack.ts";
import { task } from "$ghjk/hack.ts";

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
  {
    name: "dyn_vars",
    ghjkTs: `
import { file } from "$ghjk/hack.ts";

export const ghjk = file({});

const { env, task } = ghjk;

env("main")
  .var("A", "A#STATIC")
  .var("B", () => "B#DYNAMIC")
  .var("D",  ($) => $\`echo $A, $B > output.txt\`.text())
  .onEnter(task({ fn: ($) => $\`echo enter\` })) // not executing in test env?
`,
    ePoint: `fish`,
    stdin: `
ghjk sync main
cat output.txt
test (cat output.txt) = 'A#STATIC, B#DYNAMIC'
`,
  },
];

harness(cases.map((testCase) => ({
  ...testCase,
  fs: {
    "ghjk.ts": "ghjkTs" in testCase ? testCase.ghjkTs : genTsGhjkFile(
      {
        secureConf: {
          tasks: Object.fromEntries(
            testCase.tasks.map((def) => [def.name!, def]),
          ),
          enableRuntimes: testCase.enableRuntimesOnMasterPDAL,
        },
      },
    ),
  },
  ePoints: [{ cmd: testCase.ePoint, stdin: testCase.stdin }],
  name: `tasks/${testCase.name}`,
})));
