export { ghjk } from "../../mod.ts";
import { install, stdDeps, stdSecureConfig } from "../../mod.ts";
import { thinInstallConfig } from "../../port.ts";
import * as ports from "../../ports/mod.ts";

// specify versions
const PROTOC_VERSION = "v24.1";
const POETRY_VERSION = "1.7.0";
const PYTHON_VERSION = "3.8.18";
const CARGO_INSTA_VERSION = "1.33.0";
const NODE_VERSION = "20.8.0";
const PNPM_VERSION = "v9.0.5";

const installs = {
  python: ports.cpy_bs({ version: PYTHON_VERSION, releaseTag: "20240224" }),
  python_latest: ports.cpy_bs({ releaseTag: "20240224" }),
  node: ports.node({ version: NODE_VERSION }),
};

const allowedPortDeps = [
  ...stdDeps(),
  ...[installs.python_latest, installs.node].map((fat) => ({
    manifest: fat.port,
    defaultInst: thinInstallConfig(fat),
  })),
];

export const secureConfig = stdSecureConfig({
  additionalAllowedPorts: allowedPortDeps,
  enableRuntimes: true,
});

install(
  //others
  ports.act(),
  ports.protoc({ version: PROTOC_VERSION }),
  // cargo crate installs
  ports.cargobi({
    crateName: "cargo-insta",
    version: CARGO_INSTA_VERSION,
    locked: true,
  }),
  ports.cargo_binstall({
    crateName: "regex-lite",
  }),
);

install(
  // python package installs
  installs.python_latest,
  ports.pipi({
    packageName: "poetry",
    version: POETRY_VERSION,
  })[0],
  ports.pipi({
    packageName: "requests",
    version: "2.18.0",
  })[0],
  ports.pipi({
    packageName: "pre-commit",
  })[0],
);

install(
  // npm packages
  installs.node,
  ports.pnpm({ version: PNPM_VERSION }),
  ports.npmi({
    packageName: "yarn",
    version: "1.9.1",
  })[0],
  ports.npmi({
    packageName: "readme",
  })[0],
);
