import {
  $,
  DownloadArgs,
  dwnUrlOut,
  GithubReleasePort,
  InstallArgs,
  type InstallConfigSimple,
  osXarch,
} from "../src/deno_ports/mod.ts";
import { GithubReleasesInstConf, readGhVars } from "../src/deno_ports/ghrel.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "terragrunt_ghrel",
  version: "0.1.0-local-v1",
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
  repoOwner = "gruntwork-io";
  repoName = "terragrunt";

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
        throw new Error(`unsupported platform: ${platform}`);
    }
    const os = platform.os;

    let ext;
    switch (platform.os) {
      case "windows":
        ext = ".exe";
        break;
      case "linux":
      case "darwin":
        ext = "";
        break;
      default:
        throw new Error(`unsupported platform: ${platform}`);
    }

    return [
      this.releaseArtifactUrl(installVersion, `terragrunt_${os}_${arch}${ext}`),
    ]
      .map(dwnUrlOut)
      .map((file) => ({
        ...file,
        mode: 0o700,
        name: args.platform.os == "windows"
          ? this.repoName + ".exe"
          : this.repoName,
      }));
  }

  override async install(args: InstallArgs) {
    const [{ name: fileName }] = this.downloadUrls(args);

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }
    const binPath = await $.path(args.downloadPath)
      .join(fileName)
      .copyToDir(await installPath.join("bin").ensureDir());

    await binPath.chmod(0o700);
  }
}
