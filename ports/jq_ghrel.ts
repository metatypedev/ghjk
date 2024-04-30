import {
  $,
  DownloadArgs,
  dwnUrlOut,
  GithubReleasePort,
  InstallArgs,
  type InstallConfigSimple,
  osXarch,
  serializePlatform,
} from "../port.ts";
import { GithubReleasesInstConf, readGhVars } from "../modules/ports/ghrel.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "jq_ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  platforms: [
    ...osXarch(
      ["linux", "darwin"],
      ["aarch64", "x86_64"],
    ),
    serializePlatform({ os: "windows", arch: "x86_64" }),
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
  repoOwner = "jqlang";
  repoName = "jq";

  downloadUrls(args: DownloadArgs) {
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
        throw new Error(`unsupported platform: ${serializePlatform(platform)}`);
    }
    const os = platform.os == "darwin" ? "macos" : platform.os;

    return [
      this.releaseArtifactUrl(
        installVersion,
        `jq-${os}-${arch}${os == "windows" ? "exe" : ""}`,
      ),
    ]
      .map(dwnUrlOut)
      .map((out) => ({ ...out, mode: 0o700 }));
  }

  async install(args: InstallArgs) {
    const installPath = $.path(args.installPath);
    await $.removeIfExists(installPath);

    const [{ name: fileName }] = this.downloadUrls(args);
    const fileDwnPath = $.path(args.downloadPath).resolve(fileName);

    await fileDwnPath.copy(
      (await installPath
        .join("bin")
        .ensureDir())
        .join(
          args.platform.os == "windows" ? "jq.exe" : "jq",
        ),
    );
  }
}
