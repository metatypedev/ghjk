import {
  $,
  depExecShimPath,
  DownloadArgs,
  dwnUrlOut,
  GithubReleasePort,
  InstallArgs,
  InstallConfigSimple,
  osXarch,
  std_fs,
  std_path,
  zod,
} from "../port.ts";
import * as std_ports from "../modules/ports/std.ts";
import { GithubReleasesInstConf, readGhVars } from "../modules/ports/ghrel.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "meta_cli_ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [
    // we have to use tar because their tarballs for darwin use gnu sparse
    std_ports.tar_aa,
  ],
  platforms: osXarch(["linux", "darwin"], ["aarch64", "x86_64"]),
};

const confValidator = zod.object({
  full: zod.boolean().nullish(),
}).passthrough();

export type MetaCliInstallConf =
  & InstallConfigSimple
  & GithubReleasesInstConf
  & zod.input<typeof confValidator>;

export default function conf(
  config: MetaCliInstallConf = {},
) {
  return {
    ...readGhVars(),
    ...config,
    port: manifest,
  };
}

export class Port extends GithubReleasePort {
  repoOwner = "metatypedev";
  repoName = "metatype";

  downloadUrls(args: DownloadArgs) {
    const conf = confValidator.parse(args.config);
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
    const ext = ".tar.gz";
    switch (platform.os) {
      case "linux":
        os = "unknown-linux-gnu";
        break;
      case "darwin":
        os = "apple-darwin";
        break;
      default:
        throw new Error(`unsupported: ${platform}`);
    }
    return [
      this.releaseArtifactUrl(
        installVersion,
        `meta-cli${
          conf.full ? "-full" : ""
        }-${installVersion}-${arch}-${os}${ext}`,
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
    await std_fs.copy(
      args.tmpDirPath,
      installPath.join("bin").toString(),
    );
  }
}
