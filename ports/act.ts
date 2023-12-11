import {
  $,
  addInstallGlobal,
  DownloadArgs,
  downloadFile,
  GithubReleasePort,
  InstallArgs,
  type InstallConfigSimple,
  type PlatformInfo,
  registerDenoPortGlobal,
  std_fs,
  std_path,
  std_url,
  unarchive,
} from "../port.ts";

const manifest = {
  ty: "denoWorker" as const,
  name: "act@ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
};

registerDenoPortGlobal(manifest, () => new Port());

export default function install(config: InstallConfigSimple = {}) {
  addInstallGlobal({
    portName: manifest.name,
    ...config,
  });
}

const repoOwner = "nektos";
const repoName = "act";
const repoAddress = `https://github.com/${repoOwner}/${repoName}`;

export class Port extends GithubReleasePort {
  manifest = manifest;
  repoName = repoName;
  repoOwner = repoOwner;

  async download(args: DownloadArgs) {
    await downloadFile(args, downloadUrl(args.installVersion, args.platform));
  }

  async install(args: InstallArgs) {
    const fileName = std_url.basename(
      downloadUrl(args.installVersion, args.platform),
    );
    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);

    await unarchive(fileDwnPath, args.tmpDirPath);

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }
    await std_fs.copy(
      args.tmpDirPath,
      installPath.join("bin").toString(),
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
