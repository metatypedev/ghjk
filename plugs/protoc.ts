import {
  addInstallGlobal,
  depBinShimPath,
  DownloadArgs,
  downloadFile,
  InstallArgs,
  type InstallConfigBase,
  type PlatformInfo,
  PlugBase,
  registerDenoPlugGlobal,
  removeFile,
  spawn,
  std_fs,
  std_path,
  std_url,
} from "../plug.ts";
import * as std_plugs from "../std.ts";

const manifest = {
  name: "protoc@ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [
    std_plugs.unzip_aa,
  ],
};

registerDenoPlugGlobal(manifest, () => new Plug());

export default function install(config: InstallConfigBase = {}) {
  addInstallGlobal({
    plugName: manifest.name,
    ...config,
  });
}

const repoOwner = "protocolbuffers";
const repoName = "protobuf";
const repoAddress = `https://github.com/${repoOwner}/${repoName}`;

export class Plug extends PlugBase {
  manifest = manifest;

  async latestStable(): Promise<string> {
    const metadataRequest = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`,
    );

    const metadata = await metadataRequest.json() as {
      tag_name: string;
    };

    return metadata.tag_name;
  }

  async listAll() {
    const metadataRequest = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/releases`,
    );

    const metadata = await metadataRequest.json() as [{
      tag_name: string;
    }];

    return metadata.map((rel) => rel.tag_name).reverse();
  }

  async download(args: DownloadArgs) {
    await downloadFile(args, downloadUrl(args.installVersion, args.platform));
  }

  async install(args: InstallArgs) {
    const fileName = std_url.basename(
      downloadUrl(args.installVersion, args.platform),
    );
    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);

    await spawn([
      depBinShimPath(std_plugs.unzip_aa, "unzip", args.depShims),
      fileDwnPath,
      "-d",
      args.tmpDirPath,
    ]);

    if (await std_fs.exists(args.installPath)) {
      await removeFile(args.installPath, { recursive: true });
    }

    await std_fs.copy(
      args.tmpDirPath,
      args.installPath,
    );
  }
}

function downloadUrl(installVersion: string, platform: PlatformInfo) {
  let os;
  switch (platform.os) {
    case "linux":
      os = "linux";
      break;
    case "darwin":
      os = "osx";
      break;
    default:
      throw new Error(`unsupported os: ${platform.os}`);
  }
  let arch;
  switch (platform.arch) {
    case "x86_64":
      arch = "x86_64";
      break;
    case "aarch64":
      arch = "aarch_64";
      break;
    default:
      throw new Error(`unsupported arch: ${platform.arch}`);
  }
  return `${repoAddress}/releases/download/${installVersion}/protoc-${
    installVersion.replace(/^v/, "")
  }-${os}-${arch}.zip`;
}
