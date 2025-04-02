import {
  $,
  DownloadArgs,
  dwnUrlOut,
  GithubReleasePort,
  InstallArgs,
  type InstallConfigSimple,
  osXarch,
  std_path,
  unarchive,
} from "../src/deno_ports/mod.ts";
import {
  GithubReleasesInstConf,
  readGhVars,
} from "../src/sys_deno/ports/ghrel.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "opentofu_ghrel_fix",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  platforms: osXarch(
    ["linux", "darwin", "freebsd", "windows", "solaris"],
    ["aarch64", "x86_64"],
  ),
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
  repoOwner = "opentofu";
  repoName = "opentofu";

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

    return [
      this.releaseArtifactUrl(
        installVersion,
        `tofu_${
          installVersion.startsWith("v")
            ? installVersion.slice(1)
            : installVersion
        }_${os}_${arch}.zip`,
      ),
    ].map(dwnUrlOut);
  }

  override async install(args: InstallArgs) {
    const [{ name: fileName }] = this.downloadUrls(args);
    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);

    await unarchive(fileDwnPath, args.tmpDirPath);

    const tmpDir = $.path(args.tmpDirPath);
    const binDir = await tmpDir.join("bin").ensureDir();
    for (const fileName of ["tofu"]) {
      // deno-lint-ignore no-await-in-loop
      await tmpDir
        .join(args.platform.os == "windows" ? fileName + ".exe" : fileName)
        .renameToDir(binDir);
    }

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }
    await tmpDir.rename(installPath);
  }
}
