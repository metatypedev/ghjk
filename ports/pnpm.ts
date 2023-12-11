import {
  $,
  addInstallGlobal,
  DownloadArgs,
  downloadFile,
  GithubReleasePort,
  type InstallArgs,
  type InstallConfigSimple,
  type PlatformInfo,
  registerDenoPortGlobal,
  std_fs,
  std_url,
} from "../port.ts";

export const manifest = {
  ty: "denoWorker" as const,
  name: "pnpm@ghrel",
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

const repoOwner = "pnpm";
const repoName = "pnpm";
const repoAddress = `https://github.com/${repoOwner}/${repoName}`;

export class Port extends GithubReleasePort {
  manifest = manifest;
  repoName = repoName;
  repoOwner = repoOwner;

  async download(args: DownloadArgs) {
    await downloadFile(
      args,
      artifactUrl(args.installVersion, args.platform),
      {
        mode: 0o700,
      },
    );
  }

  async install(args: InstallArgs) {
    const fileName = std_url.basename(
      artifactUrl(args.installVersion, args.platform),
    );

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }
    await std_fs.copy(
      $.path(args.downloadPath).join(fileName).toString(),
      installPath.join(
        "bin",
        args.platform.os == "windows" ? "pnpm.exe" : "pnpm",
      ).toString(),
    );
  }
}

// pnpm distribute an executable directly
function artifactUrl(installVersion: string, platform: PlatformInfo) {
  let arch;
  let os;
  switch (platform.arch) {
    case "x86_64":
      arch = "x64";
      break;
    case "aarch64":
      arch = "arm64";
      break;
    default:
      throw new Error(`unsupported arch: ${platform.arch}`);
  }
  switch (platform.os) {
    case "linux":
      os = "linuxstatic";
      break;
    case "darwin":
      os = "macos";
      break;
    case "windows":
      os = "win";
      return `${repoAddress}/releases/download/v${installVersion}/pnpm-${os}-${arch}.exe`;
    default:
      throw new Error(`unsupported os: ${platform.arch}`);
  }
  return `${repoAddress}/releases/download/v${installVersion}/pnpm-${os}-${arch}`;
}
