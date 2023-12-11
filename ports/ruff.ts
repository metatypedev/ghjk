import {
  $,
  addInstallGlobal,
  depBinShimPath,
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
} from "../port.ts";
import * as std_ports from "../modules/ports/std.ts";

const manifest = {
  ty: "denoWorker" as const,
  name: "ruff@ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [
    // we have to use tar because their tarballs for darwin use gnu sparse
    std_ports.tar_aa,
  ],
};

registerDenoPortGlobal(manifest, () => new Port());

export default function install(config: InstallConfigSimple = {}) {
  addInstallGlobal({
    portName: manifest.name,
    ...config,
  });
}

const repoOwner = "astral-sh";
const repoName = "ruff";
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

    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);
    await $`${
      depBinShimPath(std_ports.tar_aa, "tar", args.depShims)
    } xf ${fileDwnPath} --directory=${args.tmpDirPath}`;

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }
    await std_fs.copy(
      args.tmpDirPath,
      installPath.join("bin").toString(),
    );
    // await Deno.chmod(std_path.resolve(args.installPath, "bin", "ruff"), 0o700);
  }
}

function artifactUrl(installVersion: string, platform: PlatformInfo) {
  let arch;
  switch (platform.arch) {
    case "x86_64":
      arch = "x86_64";
      break;
    case "aarch64":
      arch = "aarch64";
      break;
    default:
      throw new Error(`unsupported arch: ${platform.arch}`);
  }
  let os;
  let ext;
  switch (platform.os) {
    case "linux":
      os = "unknown-linux-musl";
      ext = "tar.gz";
      break;
    case "darwin":
      os = "apple-darwin";
      ext = "tar.gz";
      break;
    case "windows":
      os = "pc-windows-msvc";
      ext = "zip";
      break;
    default:
      throw new Error(`unsupported arch: ${platform.arch}`);
  }
  return `${repoAddress}/releases/download/${installVersion}/${repoName}-${arch}-${os}.${ext}`;
}
