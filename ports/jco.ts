import type {
  DownloadArgs,
  InstallArgs,
  InstallConfigSimple,
} from "../port.ts";
import {
  $,
  ALL_ARCH,
  ALL_OS,
  depExecShimPath,
  osXarch,
  pathsWithDepArts,
  PortBase,
  std_fs,
} from "../port.ts";
import node from "./node.ts";
import * as std_ports from "../modules/ports/std.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "jco_npm",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [
    std_ports.node_org,
  ],
  // NOTE: enable all platforms. Restrictions will apply based
  // node support this way
  platforms: osXarch([...ALL_OS], [...ALL_ARCH]),
};

export default function conf(config: InstallConfigSimple = {}) {
  return [{
    ...config,
    port: manifest,
  }, node()];
}

export class Port extends PortBase {
  async listAll() {
    const metadataRequest = await $.request(
      `https://registry.npmjs.org/@bytecodealliance/jco`,
    ).header(
      {
        // use abbreviated registry info which's still 500kb unzipped
        "Accept": "application/vnd.npm.install-v1+json",
      },
    );
    const metadata = await metadataRequest.json() as {
      versions: Record<string, unknown>;
    };

    const versions = Object.keys(metadata.versions);
    return versions;
  }

  async download(args: DownloadArgs) {
    if (await $.path(args.downloadPath).exists()) {
      return;
    }
    await $.raw`${
      depExecShimPath(std_ports.node_org, "npm", args.depArts)
    } install --no-fund @bytecodealliance/jco@${args.installVersion}`
      .cwd(args.tmpDirPath)
      .env(pathsWithDepArts(args.depArts, args.platform.os));
    await std_fs.move(args.tmpDirPath, args.downloadPath);
  }

  // FIXME: replace shebangs with the runtime dep node path
  // default shebangs just use #!/bin/env node
  async install(args: InstallArgs) {
    await std_fs.copy(
      args.downloadPath,
      args.tmpDirPath,
      { overwrite: true },
    );

    const installPath = $.path(args.installPath);

    const tmpDirPath = $.path(args.tmpDirPath);
    await tmpDirPath.join("bin").ensureDir();
    await tmpDirPath.join("bin", "jco")
      .createSymlinkTo(
        installPath
          .join("node_modules", ".bin", "jco")
          .toString(),
      );
    await $.removeIfExists(installPath);
    await std_fs.move(tmpDirPath.toString(), installPath.toString());
  }
}
