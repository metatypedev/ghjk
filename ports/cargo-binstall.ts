import {
  GithubReleasesInstConf,
  readGhVars,
} from "../src/sys_deno/ports/ghrel.ts";
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

  override downloadUrls(
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

  override async install(args: InstallArgs) {
    const [{ name: fileName }] = this.downloadUrls(args);
    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);

    await unarchive(fileDwnPath, args.tmpDirPath);

    const tmpDir = $.path(args.tmpDirPath);
    const binDir = await tmpDir.join("bin").ensureDir();
    for (
      const fileName of ["cargo-binstall", "detect-targets", "detect-wasi"]
    ) {
      // deno-lint-ignore no-await-in-loop
      await tmpDir.join(fileName).renameToDir(binDir);
    }

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }
    await tmpDir.rename(installPath);
  }
}
