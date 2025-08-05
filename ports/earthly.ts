import { GithubReleasesInstConf, readGhVars } from "../src/deno_ports/ghrel.ts";
import {
  $,
  DownloadArgs,
  GithubReleasePort,
  InstallArgs,
  InstallConfigSimple,
  osXarch,
  std_fs,
} from "../src/deno_ports/mod.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "earthly_ghrel",
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
  repoOwner = "earthly";
  repoName = "earthly";

  override downloadUrls(args: DownloadArgs) {
    const { installVersion, platform } = args;
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
    const os = platform.os;
    return [
      {
        url: this.releaseArtifactUrl(
          installVersion,
          `${this.repoName}-${os}-${arch}${os == "windows" ? ".exe" : ""}`,
        ),
        name: this.repoName + (os == "windows" ? ".exe" : ""),
        mode: 0o700,
      },
    ];
  }

  override async install(args: InstallArgs) {
    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }
    await std_fs.copy(
      args.downloadPath,
      installPath.join("bin").toString(),
    );
  }
}
