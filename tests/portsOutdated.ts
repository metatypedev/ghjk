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
    name: "command",
    installConf: [
      ports.jq_ghrel({ version: "jq-1.7" }),
    ],
    ePoint: `ghjk p outdated`,
    secureConf: {
      enableRuntimes: true,
    },
  },
  {
    name: "update_all",
    installConf: [
      ports.jq_ghrel({ version: "jq-1.7" }),
      ports.protoc({ version: "v28.2" }),
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
  ],
  name: `portsOutdated/${testCase.name}`,
  timeout_ms: 10 * 60 * 1000,
})));
