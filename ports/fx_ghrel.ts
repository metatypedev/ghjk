import {
  $,
  DownloadArgs,
  dwnUrlOut,
  GithubReleasePort,
  InstallArgs,
  InstallConfigSimple,
  osXarch,
} from "../src/deno_ports/mod.ts";
import { GithubReleasesInstConf, readGhVars } from "../src/deno_ports/ghrel.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "fx_ghrel",
  version: "0.1.0-alpha",
  moduleSpecifier: import.meta.url,
  platforms: osXarch(["linux", "windows", "darwin"], ["aarch64", "x86_64"]),
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
  repoOwner = "antonmedv";
  repoName = "fx";

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
        throw new Error(`unsupported: ${platform.arch}`);
    }
    const os = platform.os;
    let ext;
    switch (os) {
      case "linux":
      case "darwin":
        ext = "";
        break;
      case "windows":
        ext = ".exe";
        break;
      default:
        throw new Error(`unsupported: ${platform.arch}`);
    }
    return [this.releaseArtifactUrl(installVersion, `fx_${os}_${arch}${ext}`)]
      .map(dwnUrlOut)
      .map((dwn) => ({ ...dwn, name: `fx${ext}`, mode: 0o700 }));
  }

  override async install(args: InstallArgs) {
    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }
    await $.path(args.downloadPath).copy(installPath.join("bin"));
  }
}
