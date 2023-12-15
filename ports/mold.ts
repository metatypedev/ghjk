import {
  $,
  depBinShimPath,
  DownloadArgs,
  dwnUrlOut,
  GithubReleasePort,
  InstallArgs,
  type InstallConfigSimple,
  osXarch,
  std_fs,
  std_path,
} from "../port.ts";
import * as std_ports from "../modules/ports/std.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "mold_ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [
    // we have to use tar because their tarballs contain symlinks
    std_ports.tar_aa,
  ],
  platforms: osXarch(["linux"], ["aarch64", "x86_64"]),
};

export type MoldInstallConfig = InstallConfigSimple & {
  replaceLd: boolean;
};
export default function conf(config: MoldInstallConfig = { replaceLd: true }) {
  return {
    ...config,
    port: manifest,
  };
}

export class Port extends GithubReleasePort {
  repoOwner = "rui314";
  repoName = "mold";

  downloadUrls(args: DownloadArgs) {
    const { installVersion, platform } = args;

    const os = platform.os;
    const arch = platform.arch;

    return [
      this.releaseArtifactUrl(
        installVersion,
        `${this.repoName}-${
          installVersion.startsWith("v")
            ? installVersion.slice(1)
            : installVersion
        }-${arch}-${os}.tar.gz`,
      ),
    ].map(dwnUrlOut);
  }

  async install(args: InstallArgs) {
    const [{ name: fileName }] = this.downloadUrls(args);
    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);

    await $`${
      depBinShimPath(std_ports.tar_aa, "tar", args.depShims)
    } xf ${fileDwnPath} --directory=${args.tmpDirPath}`;

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }

    const dirs = [];
    for await (
      const entry of std_fs.expandGlob(
        std_path.joinGlobs([args.tmpDirPath, "*"]),
      )
    ) {
      dirs.push(entry);
    }
    if (dirs.length != 1 || !dirs[0].isDirectory) {
      throw new Error("unexpected archive contents");
    }
    await std_fs.copy(
      dirs[0].path,
      args.installPath,
    );
    if ((args.config as unknown as MoldInstallConfig).replaceLd) {
      await installPath.join("bin", "ld")
        .createSymlinkTo(installPath.join("bin", "mold").toString());
    }
  }
}
