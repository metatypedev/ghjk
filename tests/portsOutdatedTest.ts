import "../setup_logger.ts";
import { E2eTestCase, genTsGhjkFile, harness } from "./utils.ts";
import * as ports from "../ports/mod.ts";
import type { InstallConfigFat } from "../modules/ports/types.ts";
import { FileArgs } from "../mod.ts";

type CustomE2eTestCase = Omit<E2eTestCase, "ePoints" | "tsGhjkfileStr"> & {
  ePoint: string;
  installConf: InstallConfigFat | InstallConfigFat[];
  secureConf?: FileArgs;
};

// FIXME:
const cases: CustomE2eTestCase[] = [
  {
    name: "ports_outdated",
    installConf: [
      ports.jq_ghrel(),
      ports.protoc(),
      ports.ruff(),
      ...ports.npmi({ packageName: "node-gyp" }),
      ports.earthly(),
      ...ports.pipi({ packageName: "poetry" }),
    ],
    ePoint: `ghjk p outdated`,
    secureConf: {
      enableRuntimes: true,
    },
  },
  {
    name: "ports_outdated_update_all",
    installConf: [
      ports.jq_ghrel(),
      ports.protoc(),
      ports.ruff(),
      ...ports.npmi({ packageName: "node-gyp" }),
      ports.earthly(),
      ...ports.pipi({ packageName: "poetry" }),
    ],
    ePoint: `ghjk p outdated --update-all`,
    secureConf: {
      enableRuntimes: true,
    },
  },
];

harness(cases.map((testCase) => ({
  ...testCase,
  tsGhjkfileStr: genTsGhjkFile(
    {
      secureConf: {
        ...testCase.secureConf,
        installs: Array.isArray(testCase.installConf)
          ? testCase.installConf
          : [testCase.installConf],
      },
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
  name: `portsOutdated/${testCase.name}`,
  ignore: true,
})));
