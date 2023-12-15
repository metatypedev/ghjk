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
  name: "mold@ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [
    // we have to use tar because their tarballs contain symlinks
    std_ports.tar_aa,
  ],
};

registerDenoPortGlobal(manifest, () => new Port());

export type MoldInstallConfig = InstallConfigSimple & {
  replaceLd: boolean;
};
export default function install(
  config: MoldInstallConfig = { replaceLd: true },
) {
  addInstallGlobal({
    portName: manifest.name,
    ...config,
  });
}

const repoOwner = "rui314";
const repoName = "mold";
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

    await $`${
      depBinShimPath(std_ports.tar_aa, "tar", args.depShims)
    } xf ${fileDwnPath} --directory=${args.tmpDirPath}`;

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }

    const dirs = [];
    for await (
      const entry of std_fs.expandGlob(
        std_path.joinGlobs([args.tmpDirPath, "*"]),
      )
    ) {
      dirs.push(entry);
    }
    if (dirs.length != 1 || !dirs[0].isDirectory) {
      throw new Error("unexpected archive contents");
    }
    await std_fs.copy(
      dirs[0].path,
      args.installPath,
    );
    if ((args.config as unknown as MoldInstallConfig).replaceLd) {
      await installPath.join("bin", "ld")
        .createSymlinkTo(installPath.join("bin", "mold").toString());
    }
  }
}

function downloadUrl(installVersion: string, platform: PlatformInfo) {
  if (platform.os == "linux") {
    const os = "linux";
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
    return `${repoAddress}/releases/download/${installVersion}/${repoName}-${
      installVersion.startsWith("v") ? installVersion.slice(1) : installVersion
    }-${arch}-${os}.tar.gz`;
  } else {
    throw new Error(`unsupported os: ${platform.os}`);
  }
}
