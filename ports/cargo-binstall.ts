import { GithubReleasesInstConf, readGhVars } from "../modules/ports/ghrel.ts";
import {
  $,
  DownloadArgs,
  dwnUrlOut,
  GithubReleasePort,
  InstallArgs,
  InstallConfigSimple,
  osXarch,
  std_fs,
  std_path,
  unarchive,
} from "../port.ts";

export const manifest = {
  ty: "denoWorker@v1" as const,
  name: "cargo_binstall_ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  platforms: osXarch(["linux", "darwin"], ["aarch64", "x86_64"]),
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
  repoOwner = "cargo-bins";
  repoName = "cargo-binstall";

  downloadUrls(
    args: DownloadArgs,
  ) {
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
    let fileName;
    if (platform.os == "darwin") {
      // NOTE: the archive file name extensions are different from os to os
      fileName = `${this.repoName}-${arch}-apple-darwin.full.zip`;
    } else if (platform.os == "linux") {
      // TODO: support for ubuntu/debian versions
      // we'll need a way to expose that to ports
      const os = "unknown-linux-musl";
      fileName = `${this.repoName}-${arch}-${os}.full.tgz`;
    } else {
      throw new Error(`unsupported os: ${platform.os}`);
    }
    return [
      this.releaseArtifactUrl(
        installVersion.match(/^v/) ? installVersion : `v${installVersion}`,
        fileName,
      ),
    ].map(dwnUrlOut);
  }

  async install(args: InstallArgs) {
    const [{ name: fileName }] = this.downloadUrls(args);
    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);

    await unarchive(fileDwnPath, args.tmpDirPath);

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }

    const neededFileNames = ["cargo-binstall", "detect-targets", "detect-wasi"];
    const destination = std_path.resolve(args.installPath, "bin");
    for (const fileName of neededFileNames) {
      const sourceFile = std_path.resolve(args.tmpDirPath, fileName);
      await std_fs.copy(sourceFile, destination);
    }
  }
}
