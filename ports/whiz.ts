import {
  $,
  depExecShimPath,
  DownloadArgs,
  dwnUrlOut,
  GithubReleasePort,
  InstallArgs,
  type InstallConfigSimple,
  osXarch,
  std_fs,
  std_path,
} from "../port.ts";
import * as std_ports from "../modules/ports/std.ts";
import { GithubReleasesInstConf, readGhVars } from "../modules/ports/ghrel.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "whiz_ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [
    // we have to use tar because their tarballs for darwin use gnu sparse
    std_ports.tar_aa,
  ],
  platforms: osXarch(["linux", "darwin", "windows"], ["aarch64", "x86_64"]),
};

export default function conf(
  config: InstallConfigSimple & GithubReleasesInstConf = {},
) {
  return {
    ...readGhVars(),
    ...config,
    port: manifest,
  };
}

export class Port extends GithubReleasePort {
  repoOwner = "zifeo";
  repoName = "whiz";

  downloadUrls(args: DownloadArgs) {
    const { installVersion, platform } = args;
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
    const ext = "tar.gz";
    switch (platform.os) {
      case "linux":
        os = "unknown-linux-musl";
        break;
      case "darwin":
        os = "apple-darwin";
        break;
      case "windows":
        os = "pc-windows-msvc";
        break;
      default:
        throw new Error(`unsupported arch: ${platform.arch}`);
    }

    return [
      this.releaseArtifactUrl(
        installVersion,
        `${this.repoName}-${installVersion}-${arch}-${os}.${ext}`,
      ),
    ].map(dwnUrlOut);
  }

  async install(args: InstallArgs) {
    const [{ name: fileName }] = this.downloadUrls(args);
    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);
    await $`${
      depExecShimPath(std_ports.tar_aa, "tar", args.depArts)
    } xf ${fileDwnPath} --directory=${args.tmpDirPath}`;

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
