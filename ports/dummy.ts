//! this is a dumb port to be used for testing

import type {
  DownloadArgs,
  InstallArgs,
  InstallConfigSimple,
} from "../port.ts";
import { $, ALL_ARCH, ALL_OS, osXarch, PortBase, std_fs } from "../port.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "dummy",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [],
  platforms: osXarch([...ALL_OS], [...ALL_ARCH]),
};

export default function conf(config: InstallConfigSimple = {}) {
  return {
    ...config,
    port: manifest,
  };
}

export class Port extends PortBase {
  execEnv() {
    return {
      DUMMY_ENV: "dummy",
    };
  }

  listAll() {
    return ["dummy"];
  }

  async download(args: DownloadArgs) {
    // TODO: windows suport
    await $.path(args.downloadPath).join("bin", "dummy").writeText(
      `#!/bin/sh 
echo 'dummy hey'`,
      {
        mode: 0o700,
      },
    );
  }

  async install(args: InstallArgs) {
    const installPath = $.path(args.installPath);
    await $.removeIfExists(installPath);
    await std_fs.copy(args.downloadPath, args.installPath);
  }
}
