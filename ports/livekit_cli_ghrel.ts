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
  name: "livekit_cli_ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  // darwin releases only avail on brew
  platforms: osXarch(["linux", "windows"], ["aarch64", "x86_64"]),
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
  repoOwner = "livekit";
  repoName = "livekit-cli";

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
        ext = "tar.gz";
        break;
      case "windows":
        ext = "zip";
        break;
      default:
        throw new Error(`unsupported: ${platform.arch}`);
    }
    return [
      this.releaseArtifactUrl(
        installVersion,
        `lk_${installVersion.replace(/^v/, "")}_${os}_${arch}.${ext}`,
      ),
    ].map(dwnUrlOut);
  }

  override async install(args: InstallArgs) {
    const [{ name: fileName }] = this.downloadUrls(args);

    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);
    await unarchive(fileDwnPath, args.tmpDirPath);

    const tmpDir = $.path(args.tmpDirPath);
    const binDir = await tmpDir.join("bin").ensureDir();
    for (const fileName of ["lk"]) {
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
