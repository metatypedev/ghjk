import {
  addInstallGlobal,
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
} from "../port.ts";

const manifest = {
  name: "earthly@ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
};

registerDenoPlugGlobal(manifest, () => new Plug());

export default function install(config: InstallConfigBase = {}) {
  addInstallGlobal({
    plugName: manifest.name,
    ...config,
  });
}

const repoOwner = "earthly";
const repoName = "earthly";
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
    const fileName = repoName;
    await downloadFile(args, downloadUrl(args.installVersion, args.platform), {
      mode: 0o700,
      fileName,
    });
  }

  async install(args: InstallArgs) {
    const fileName = repoName;
    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);

    if (await std_fs.exists(args.installPath)) {
      await removeFile(args.installPath, { recursive: true });
    }
    await std_fs.ensureDir(std_path.resolve(args.installPath, "bin"));
    await std_fs.copy(
      fileDwnPath,
      std_path.resolve(args.installPath, "bin", fileName),
    );
  }
}

function downloadUrl(installVersion: string, platform: PlatformInfo) {
  let arch;
  switch (platform.arch) {
    case "x86_64":
      arch = "amd64";
      break;
    case "aarch64":
      arch = "arm64";
      break;
    default:
      throw new Error(`unsupported arch: ${platform.arch}`);
  }
  let os;
  switch (platform.os) {
    case "linux":
      os = "linux";
      break;
    case "darwin":
      os = "darwin";
      break;
    default:
      throw new Error(`unsupported arch: ${platform.arch}`);
  }
  return `${repoAddress}/releases/download/${installVersion}/${repoName}-${os}-${arch}`;
}
