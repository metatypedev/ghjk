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
  std_fs,
  std_path,
  std_url,
  workerSpawn,
} from "../plug.ts";
import * as std_plugs from "../std.ts";

const manifest = {
  name: "act@ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [
    std_plugs.tar_aa,
  ],
};

registerDenoPlugGlobal(manifest, () => new Plug());

export default function install(config: InstallConfigBase = {}) {
  addInstallGlobal({
    plugName: manifest.name,
    ...config,
  });
}

const repoOwner = "nektos";
const repoName = "act";
const repoAddress = `https://github.com/${repoOwner}/${repoName}`;

export class Plug extends PlugBase {
  manifest = manifest;

  listBinPaths(): string[] {
    return [
      "act",
    ];
  }
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

    await workerSpawn([
      depBinShimPath(std_plugs.tar_aa, "tar", args.depShims),
      "xf",
      fileDwnPath,
      `--directory=${args.tmpDirPath}`,
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
  let arch;
  switch (platform.arch) {
    case "x86_64":
      arch = "x86_64";
      break;
    case "aarch64":
      arch = "arm64";
      break;
    default:
      throw new Error(`unsupported arch: ${platform.arch}`);
  }
  let os;
  let ext;
  switch (platform.os) {
    case "linux":
      os = "Linux";
      ext = "tar.gz";
      break;
    case "darwin":
      os = "Darwin";
      ext = "tar.gz";
      break;
    case "windows":
      os = "Windows";
      ext = "zip";
      break;
    default:
      throw new Error(`unsupported arch: ${platform.arch}`);
  }
  return `${repoAddress}/releases/download/${installVersion}/${repoName}_${os}_${arch}.${ext}`;
}
