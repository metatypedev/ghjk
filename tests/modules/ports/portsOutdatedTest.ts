import "../../../setup_logger.ts";
import { DenoFileSecureConfig, stdSecureConfig } from "../../../mod.ts";
import { E2eTestCase, genTsGhjkFile, harness } from "../../utils.ts";
import * as ports from "../../../ports/mod.ts";
import type { InstallConfigFat } from "../../../modules/ports/types.ts";

type CustomE2eTestCase = Omit<E2eTestCase, "ePoints" | "tsGhjkfileStr"> & {
  ePoint: string;
  installConf: InstallConfigFat | InstallConfigFat[];
  secureConf?: DenoFileSecureConfig;
};

const cases: CustomE2eTestCase[] = [
  // 0 megs
  {
    name: "check ports outdated",
    installConf: [
      ports.jq_ghrel(),
      ports.protoc(),
      ports.ruff(),
      ...ports.npmi({ packageName: "node-gyp" }),
      ports.earthly(),
      ...ports.pipi({ packageName: "poetry" }),
    ],
    ePoint: `ghjk p outdated`,
    secureConf: stdSecureConfig({
      enableRuntimes: true,
    }),
  },
  {
    name: "check ports outdated",
    installConf: [
      ports.jq_ghrel(),
      ports.protoc(),
      ports.ruff(),
      ...ports.npmi({ packageName: "node-gyp" }),
      ports.earthly(),
      ...ports.pipi({ packageName: "poetry" }),
    ],
    ePoint: `ghjk p outdated --update-all`,
    secureConf: stdSecureConfig({
      enableRuntimes: true,
    }),
  },
];

harness(cases.map((testCase) => ({
  ...testCase,
  tsGhjkfileStr: genTsGhjkFile(
    {
      installConf: testCase.installConf,
      secureConf: testCase.secureConf,
      taskDefs: [],
    },
  ),
  ePoints: [
    ...["bash -c", "fish -c", "zsh -c"].map((sh) => ({
      cmd: [...`env ${sh}`.split(" "), `"${testCase.ePoint}"`],
    })),
    /* // FIXME: better tests for the `InstallDb`
                // installs db means this shouldn't take too long
                // as it's the second sync
                {
                  cmd: [
                    ..."env".split(" "),
                    "bash -c 'timeout 1 ghjk envs cook'",
                  ],
                }, */
  ],
  // building the test docker image might taka a while
  // but we don't want some bug spinlocking the ci for
  // an hour
  timeout_ms: 5 * 60 * 1000,
  name: `ports/${testCase.name}`,
})));
