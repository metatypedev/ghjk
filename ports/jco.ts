import {
  $,
  addInstallGlobal,
  depBinShimPath,
  type DownloadArgs,
  downloadFile,
  type InstallArgs,
  type InstallConfigSimple,
  type ListAllArgs,
  pathWithDepShims,
  type PlatformInfo,
  PortBase,
  registerDenoPortGlobal,
  std_fs,
  std_path,
  std_url,
  unarchive,
} from "../port.ts";
import node from "./node.ts";
import * as std_ports from "../modules/ports/std.ts";

const manifest = {
  ty: "denoWorker" as const,
  name: "jco@npm",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [
    std_ports.node_org,
  ],
};
registerDenoPortGlobal(manifest, () => new Port());

export default function install(config: InstallConfigSimple = {}) {
  addInstallGlobal({
    portName: manifest.name,
    ...config,
  });
  // FIXME: conflict flags for install configs
  node({});
}

class Port extends PortBase {
  manifest = manifest;

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

  async download(args: DownloadArgs) {
    await downloadFile(
      args,
      artifactUrl(args.installVersion, args.platform),
    );
  }

  async install(args: InstallArgs) {
    const fileName = std_url.basename(
      artifactUrl(args.installVersion, args.platform),
    );
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
      depBinShimPath(std_ports.node_org, "npm", args.depShims)
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

function artifactUrl(installVersion: string, _platform: PlatformInfo) {
  return `https://registry.npmjs.org/@bytecodealliance/jco/-/jco-${installVersion}.tgz`;
}
