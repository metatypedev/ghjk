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
  std_url,
  unarchive,
} from "../port.ts";

const manifest = {
  ty: "denoWorker" as const,
  name: "protoc@ghrel",
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

const repoOwner = "protocolbuffers";
const repoName = "protobuf";
const repoAddress = `https://github.com/${repoOwner}/${repoName}`;

export class Port extends GithubReleasePort {
  manifest = manifest;
  repoName = repoName;
  repoOwner = repoOwner;

  async download(args: DownloadArgs) {
    await downloadFile(args, artifactUrl(args.installVersion, args.platform));
  }

  async install(args: InstallArgs) {
    const fileName = std_url.basename(
      artifactUrl(args.installVersion, args.platform),
    );
    const fileDwnPath = $.path(args.downloadPath).join(fileName);

    await unarchive(fileDwnPath.toString(), args.tmpDirPath);

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }

    await std_fs.copy(
      args.tmpDirPath,
      args.installPath,
    );
  }
}

function artifactUrl(installVersion: string, platform: PlatformInfo) {
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
