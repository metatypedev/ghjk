import {
  $,
  ALL_ARCH,
  ALL_OS,
  depExecShimPath,
  type DownloadArgs,
  dwnUrlOut,
  type InstallArgs,
  type InstallConfigSimple,
  type ListAllArgs,
  osXarch,
  pathWithDepShims,
  PortBase,
  std_fs,
  std_path,
  unarchive,
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
  async listAll(_env: ListAllArgs) {
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

  downloadUrls(args: DownloadArgs) {
    const { installVersion } = args;
    return [
      `https://registry.npmjs.org/@bytecodealliance/jco/-/jco-${installVersion}.tgz`,
    ].map(dwnUrlOut);
  }

  async install(args: InstallArgs) {
    const [{ name: fileName }] = this.downloadUrls(args);
    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);

    await unarchive(fileDwnPath, args.tmpDirPath);

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }

    await std_fs.copy(
      std_path.resolve(
        args.tmpDirPath,
        "package",
      ),
      args.installPath,
    );
    await $`${
      depExecShimPath(std_ports.node_org, "npm", args.depShims)
    } install --no-fund`
      .cwd(args.installPath)
      .env({
        PATH: pathWithDepShims(args.depShims),
      });
    await installPath.join("bin").ensureDir();
    await installPath.join("bin", "jco")
      .createSymlinkTo(installPath.join("src", "jco.js").toString());
  }
}
