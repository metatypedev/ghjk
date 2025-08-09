import {
  $,
  DownloadArgs,
  dwnUrlOut,
  GithubReleasePort,
  InstallArgs,
  InstallConfigSimple,
  osXarch,
  std_path,
  unarchive,
} from "../src/deno_ports/mod.ts";
import { GithubReleasesInstConf, readGhVars } from "../src/deno_ports/ghrel.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "deno_ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  platforms: osXarch(["linux", "darwin", "windows"], ["aarch64", "x86_64"]),
};

export default function conf(
  config:
    & InstallConfigSimple
    & GithubReleasesInstConf = {},
) {
  return {
    ...readGhVars(),
    ...config,
    port: manifest,
  };
}

export class Port extends GithubReleasePort {
  repoOwner = "denoland";
  repoName = "deno";

  override downloadUrls(args: DownloadArgs) {
    const { installVersion, platform } = args;
    const arch = platform.arch;
    let os;
    switch (platform.os) {
      case "linux":
        os = "unknown-linux-gnu";
        break;
      case "windows":
        os = "windows-msvc";
        break;
      case "darwin":
        os = "apple-darwin";
        break;
      default:
        throw new Error(`unsupported: ${platform}`);
    }
    return [
      this.releaseArtifactUrl(
        installVersion,
        `deno-${arch}-${os}.zip`,
      ),
    ].map(dwnUrlOut);
  }

  override async install(args: InstallArgs) {
    const [{ name: fileName }] = this.downloadUrls(args);

    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);
    await unarchive(fileDwnPath, args.tmpDirPath);

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }
    await $.path(args.tmpDirPath)
      .rename(await installPath.join("bin").ensureDir());
  }
}
