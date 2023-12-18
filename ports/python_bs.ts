import {
  $,
  depExecShimPath,
  DownloadArgs,
  dwnUrlOut,
  exponentialBackoff,
  InstallArgs,
  InstallConfigSimple,
  osXarch,
  PortBase,
  std_fs,
} from "../port.ts";

const tar_aa_id = {
  name: "tar_aa",
};
const zstd_aa_id = {
  name: "zstd_aa",
};

export const manifest = {
  ty: "denoWorker@v1" as const,
  name: "python_bs_ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [tar_aa_id, zstd_aa_id],
  platforms: osXarch(["linux", "darwin", "windows"], ["x86_64", "aarch64"]),
};

export default function conf(config: InstallConfigSimple = {}) {
  return {
    ...config,
    port: manifest,
  };
}

export class Port extends PortBase {
  repoOwner = "indygreg";
  repoName = "python-build-standalone";

  async listAll() {
    // python-build-standalone builds all supported versions of python
    // on every release
    const metadata = await $.withRetries({
      count: 10,
      delay: exponentialBackoff(1000),
      action: async () =>
        await $.request(
          `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/latest`,
        ).json() as {
          assets: { name: string }[];
        },
    });
    return [
      // we put all the asset versions found in a set
      // to dedupe
      ...new Set(
        metadata
          .assets
          .map((ass) => ass.name.match(/cpython-([\d.]*)\+/)?.[1])
          .filter((str): str is string => !!str && str.length > 0),
      ).values(),
    ]
      // sort them numerically to make sure version 0.10.0 comes after 0.2.9
      .sort((sa, sb) => sa.localeCompare(sb, undefined, { numeric: true }));
  }

  async downloadUrls(args: DownloadArgs) {
    const latestMeta = await $.withRetries({
      count: 10,
      delay: exponentialBackoff(1000),
      action: async () =>
        await $.request(
          `https://raw.githubusercontent.com/${this.repoOwner}/${this.repoName}/latest-release/latest-release.json`,
        ).json() as {
          "version": number;
          "tag": string;
          "release_url": string;
          "asset_url_prefix": string;
        },
    });
    if (latestMeta.version != 1) {
      throw new Error(
        `${this.repoOwner}/${this.repoName} have changed their latest release tag json version ${
          $.inspect(latestMeta)
        }`,
      );
    }
    const { installVersion, platform } = args;
    const arch = platform.arch;
    let os;
    switch (platform.os) {
      case "windows":
        os = "windows-msvc-shared";
        break;
      case "linux":
        // NOTE: python-build-standalone have musl builds
        // but it breaks python extensions support so we
        // must use glibc
        os = "unknown-linux-gnu";
        break;
      case "darwin":
        os = "apple-darwin";
        break;
      default:
        throw new Error(`unsupported: ${platform}`);
    }
    return [
      `${latestMeta.asset_url_prefix}/cpython-${installVersion}+${latestMeta.tag}-${arch}-${os}-pgo+lto-full.tar.zst`,
    ].map(dwnUrlOut);
  }

  async install(args: InstallArgs) {
    const [_, fileDwnEntry] = await Array.fromAsync(
      $.path(args.downloadPath).walk(),
    );
    const fileDwnPath = fileDwnEntry.path.toString();
    await $`${
      depExecShimPath(tar_aa_id, "tar", args.depShims)
    } xf ${fileDwnPath} --directory=${args.tmpDirPath}`;

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }
    await std_fs.move(
      $.path(args.tmpDirPath).join("python", "install").toString(),
      installPath.toString(),
    );
  }
}
