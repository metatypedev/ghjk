import {
  $,
  DownloadArgs,
  dwnUrlOut,
  GithubReleasePort,
  InstallArgs,
  InstallConfigSimple,
  ListAllArgs,
  osXarch,
  std_fs,
  std_path,
  unarchive,
} from "../src/deno_ports/mod.ts";
import {
  GithubReleasesInstConf,
  readGhVars,
} from "../src/sys_deno/ports/ghrel.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "infisical_ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  // NOTE: infisical supports more arches than deno
  platforms: osXarch(["linux", "darwin", "windows", "netbsd", "freebsd"], [
    "aarch64",
    "x86_64",
  ]),
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
  repoOwner = "Infisical";
  repoName = "infisical";

  override async listAll(args: ListAllArgs) {
    const all = await super.listAll(args);
    return all.map((str) => str.replace(/^infisical-cli\/v/, ""));
  }
  override async latestStable(args: ListAllArgs) {
    const lsv = await super.latestStable(args);
    return lsv.replace(/^infisical-cli\/v/, "");
  }

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
    let ext;
    switch (platform.os) {
      case "linux":
      case "netbsd":
      case "freebsd":
      case "darwin":
        ext = "tar.gz";
        break;
      case "windows":
        ext = "zip";
        break;
      default:
        throw new Error(`unsupported arch: ${platform.arch}`);
    }
    return [
      this.releaseArtifactUrl(
        `infisical-cli/v${installVersion}`,
        `${this.repoName}_${installVersion}_${os}_${arch}.${ext}`,
      ),
    ].map(dwnUrlOut);
  }

  override async install(args: InstallArgs) {
    const [{ name: fileName }] = this.downloadUrls(args);

    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);
    await unarchive(fileDwnPath, args.tmpDirPath);
    // await $`${
    //   depExecShimPath(std_ports.tar_aa, "tar", args.depArts)
    // } xf ${fileDwnPath} --directory=${args.tmpDirPath}`;

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }
    await std_fs.copy(
      args.tmpDirPath,
      installPath.join("bin").toString(),
    );
    // await Deno.chmod(std_path.resolve(args.installPath, "bin", "ruff"), 0o700);
  }
}
