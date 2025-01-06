export { sophon } from "ghjk/hack.ts";
import { config, install } from "ghjk/hack.ts";
import * as ports from "ghjk/ports/mod.ts";

const installs = {
  python: ports.cpy_bs({ version: "3.8.18", releaseTag: "20240224" }),
  python_latest: ports.cpy_bs({ releaseTag: "20240224" }),
  node: ports.node({ version: "20.8.0" }),
};

config({
  stdDeps: true,
  allowedBuildDeps: [
    installs.python_latest,
    installs.node,
  ],
  enableRuntimes: true,
});

install(
  //others
  ports.act(),
  ports.protoc({ version: "v24.1" }),
  // cargo crate installs
  ports.cargobi({
    crateName: "cargo-insta",
    version: "1.33.0",
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
    version: "1.7.0",
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
  ports.pnpm({ version: "v9.0.5" }),
  ports.npmi({
    packageName: "yarn",
    version: "1.9.1",
  })[0],
  ports.npmi({
    packageName: "readme",
  })[0],
);
