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
} from "../src/deno_ports/mod.ts";
import { GithubReleasesInstConf, readGhVars } from "../src/deno_ports/ghrel.ts";
import * as std_ports from "../src/sys_deno/ports/std.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "lade_ghrel",
  version: "0.1.1",
  moduleSpecifier: import.meta.url,
  buildDeps: [std_ports.tar_aa],
  platforms: [
    ...osXarch(["linux", "darwin"], ["aarch64", "x86_64"]),
    ...osXarch(["windows"], ["x86_64"]),
  ],
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
  repoName = "lade";

  override downloadUrls(args: DownloadArgs) {
    const { installVersion, platform } = args;

    const arch = platform.arch;
    let os;
    switch (platform.os) {
      case "linux":
        os = "unknown-linux-gnu";
        break;
      case "darwin":
        os = "apple-darwin";
        break;
      case "windows":
        os = "pc-windows-msvc";
        break;
      default:
        throw new Error(`unsupported platform: ${platform}`);
    }

    return [
      this.releaseArtifactUrl(
        installVersion,
        `${this.repoName}-${installVersion}-${arch}-${os}.tar.gz`,
      ),
    ].map(dwnUrlOut);
  }

  override async install(args: InstallArgs) {
    const [{ name: fileName }] = this.downloadUrls(args);

    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);
    await $`${
      depExecShimPath(
        std_ports.tar_aa,
        "tar",
        args.depArts,
      )
    } xf ${fileDwnPath} --directory=${args.tmpDirPath}`;

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }
    await std_fs.copy(args.tmpDirPath, installPath.join("bin").toString());
  }
}
