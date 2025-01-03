import { GithubReleasesInstConf, readGhVars } from "../modules/ports/ghrel.ts";
import {
  $,
  DownloadArgs,
  GithubReleasePort,
  type InstallArgs,
  InstallConfigSimple,
  osXarch,
  std_fs,
} from "../port.ts";

export const manifest = {
  ty: "denoWorker@v1" as const,
  name: "pnpm_ghrel",
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
  repoOwner = "pnpm";
  repoName = "pnpm";

  override downloadUrls(args: DownloadArgs) {
    const { installVersion, platform } = args;
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
    let ext = "";
    switch (platform.os) {
      case "linux":
        os = "linuxstatic";
        break;
      case "darwin":
        os = "macos";
        break;
      case "windows":
        os = "win";
        ext = ".exe";
        break;
      default:
        throw new Error(`unsupported: ${platform}`);
    }

    // NOTE: pnpm distribute an executable directly
    return [
      {
        url: this.releaseArtifactUrl(
          installVersion,
          `${this.repoName}-${os}-${arch}${ext}`,
        ),
        name: `${this.repoName}${ext}`,
        mode: 0o700,
      },
    ];
  }

  override async install(args: InstallArgs) {
    const [{ name: fileName }] = this.downloadUrls(args);

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }
    await std_fs.copy(
      $.path(args.downloadPath).join(fileName).toString(),
      (
        await installPath.join("bin").ensureDir()
      )
        .join(fileName)
        .toString(),
    );
  }
}
