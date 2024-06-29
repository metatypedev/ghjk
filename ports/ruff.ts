import {
  $,
  depExecShimPath,
  DownloadArgs,
  dwnUrlOut,
  GithubReleasePort,
  InstallArgs,
  InstallConfigSimple,
  osXarch,
  semver,
  std_fs,
  std_path,
} from "../port.ts";
import * as std_ports from "../modules/ports/std.ts";
import { GithubReleasesInstConf, readGhVars } from "../modules/ports/ghrel.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "ruff_ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  buildDeps: [
    // we have to use tar because their tarballs for darwin use gnu sparse
    std_ports.tar_aa,
  ],
  // NOTE: ruff supports more arches than deno
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
  repoOwner = "astral-sh";
  repoName = "ruff";

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
        throw new Error(`unsupported: ${platform}`);
    }
    let os;
    let ext;
    switch (platform.os) {
      case "linux":
        os = "unknown-linux-musl";
        ext = "tar.gz";
        break;
      case "darwin":
        os = "apple-darwin";
        ext = "tar.gz";
        break;
      case "windows":
        os = "pc-windows-msvc";
        ext = "zip";
        break;
      default:
        throw new Error(`unsupported: ${platform}`);
    }
    const parsedVersion = semver.parse(installVersion);
    const prefix = semver.lessThan(parsedVersion, semver.parse("0.1.8"))
      ? this.repoName
      : semver.greaterOrEqual(
          parsedVersion,
          semver.parse("0.5.0"),
        )
      ? `${this.repoName}`
      : `${this.repoName}-${installVersion.replace(/^v/, "")}`;
    return [
      this.releaseArtifactUrl(
        installVersion,
        `${prefix}-${arch}-${os}.${ext}`,
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

    const parsedVersion = semver.parse(args.installVersion);
    if (
      semver.greaterOrEqual(
        parsedVersion,
        semver.parse("0.5.0"),
      )
    ) {
      const [_root, dir] = await Array.fromAsync(
        $.path(args.tmpDirPath).walk({ maxDepth: 1 }),
      );
      if (!dir.isDirectory) {
        throw new Error("unexpected archive structure");
      }
      await installPath.ensureDir();
      await dir.path.rename(installPath.join("bin"));
    } else {
      await std_fs.copy(
        args.tmpDirPath,
        installPath.join("bin").toString(),
      );
    }
    // await Deno.chmod(std_path.resolve(args.installPath, "bin", "ruff"), 0o700);
  }
}
