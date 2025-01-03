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
  unarchive,
} from "../port.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "protoc_ghrel",
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
  repoOwner = "protocolbuffers";
  repoName = "protobuf";

  override downloadUrls(args: DownloadArgs) {
    const { installVersion, platform } = args;
    let os;
    switch (platform.os) {
      case "linux":
        os = "linux";
        break;
      case "darwin":
        os = "osx";
        break;
      default:
        throw new Error(`unsupported: ${platform}`);
    }
    let arch;
    switch (platform.arch) {
      case "x86_64":
        arch = "x86_64";
        break;
      case "aarch64":
        arch = "aarch_64";
        break;
      default:
        throw new Error(`unsupported: ${platform}`);
    }

    return [
      this.releaseArtifactUrl(
        installVersion,
        `protoc-${installVersion.replace(/^v/, "")}-${os}-${arch}.zip`,
      ),
    ].map(dwnUrlOut);
  }

  override async install(args: InstallArgs) {
    const [{ name: fileName }] = this.downloadUrls(args);
    const fileDwnPath = $.path(args.downloadPath).join(fileName);

    await unarchive(fileDwnPath.toString(), args.tmpDirPath);

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }

    await std_fs.copy(
      args.tmpDirPath,
      args.installPath,
    );
  }
}
