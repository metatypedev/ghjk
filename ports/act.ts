import { GithubReleasesInstConf, readGhVars } from "../modules/ports/ghrel.ts";
import {
  $,
  type DownloadArgs,
  dwnUrlOut,
  GithubReleasePort,
  type InstallArgs,
  type InstallConfigSimple,
  osXarch,
  std_path,
  unarchive,
} from "../port.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "act_ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
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
  repoOwner = "nektos";
  repoName = "act";

  downloadUrls(args: DownloadArgs) {
    const { installVersion, platform } = args;
    let arch;
    switch (platform.arch) {
      case "x86_64":
        arch = "x86_64";
        break;
      case "aarch64":
        arch = "arm64";
        break;
      default:
        throw new Error(`unsupported: ${platform}`);
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
        throw new Error(`unsupported: ${platform}`);
    }

    return [
      this.releaseArtifactUrl(
        installVersion,
        `${this.repoName}_${os}_${arch}.${ext}`,
      ),
    ].map(dwnUrlOut);
  }

  async install(args: InstallArgs) {
    const [{ name: fileName }] = this.downloadUrls(args);
    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);

    await unarchive(fileDwnPath, args.tmpDirPath);

    const tmpDir = $.path(args.tmpDirPath);
    const binDir = await tmpDir.join("bin").ensureDir();
    for (
      const fileName of ["act"]
    ) {
      await tmpDir.join(
        args.platform.os == "windows" ? fileName + ".exe" : fileName,
      ).renameToDir(binDir);
    }

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }
    await tmpDir.rename(installPath);
  }
}
