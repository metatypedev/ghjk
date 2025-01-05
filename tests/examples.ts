import "../setup_logger.ts";
import { E2eTestCase, harness } from "./utils.ts";

type CustomE2eTestCase = Omit<E2eTestCase, "ePoints" | "fs"> & {
  stdin: string;
};

// TODO: check each eaxmple works

const cases: CustomE2eTestCase[] = [{
  name: "template_ts",
  stdin: `
rm -r .ghjk
rm ghjk.ts
ghjk init ts
ghjk sync
`,
}];

harness(cases.map((testCase) => ({
  ...testCase,
  fs: {
    "ghjk.ts": `
export { sophon } from "$ghjk/hack.ts";
`,
  },
  ePoints: [{ cmd: "fish", stdin: testCase.stdin }],
  name: `examples/${testCase.name}`,
})));
