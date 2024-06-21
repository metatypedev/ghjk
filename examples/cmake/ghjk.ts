export { ghjk } from "../../mod.ts";
import { install, secureConfig as ssecureConfig, stdDeps } from "../../mod.ts";
import * as ports from "../../ports/mod.ts";
import { thinInstallConfig } from "../../utils/mod.ts";

const CMAKE_VERSION = "3.29.5.1";
const PYTHON_VERSION = "3.8.18";

const installs = {
  python: ports.cpy_bs({ version: PYTHON_VERSION, releaseTag: "20240224" }),
  python_latest: ports.cpy_bs({ releaseTag: "20240224" }),
};

const allowedPortDeps = [
  ...stdDeps(),
  ...[installs.python_latest].map((fat) => ({
    manifest: fat.port,
    defaultInst: thinInstallConfig(fat),
  })),
];

export const secureConfig = ssecureConfig({ allowedPortDeps });
// export const secureConfig = ghjk.secureConfig({
//     allowedPortDeps: [...ghjk.stdDeps({ enableRuntimes: true })],
//   });

install(
  ports.pipi({
    packageName: "cmake",
    version: CMAKE_VERSION,
  })[0],
);

install(
  ports.cmake({
    version: CMAKE_VERSION,
  })[0],
);
