import {
  ghHeaders,
  GithubReleasesInstConf,
  readGhVars,
} from "../modules/ports/ghrel.ts";
import { PortArgsBase } from "../modules/ports/types.ts";
import {
  $,
  defaultLatestStable,
  depExecShimPath,
  downloadFile,
  dwnUrlOut,
  osXarch,
  PortBase,
  std_fs,
  zod,
} from "../port.ts";
import type {
  DownloadArgs,
  InstallArgs,
  InstallConfigSimple,
  ListAllArgs,
} from "../port.ts";

const tar_aa_id = {
  name: "tar_aa",
};
const zstd_aa_id = {
  name: "zstd_aa",
};

export const manifest = {
  ty: "denoWorker@v1" as const,
  name: "cpy_bs_ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  // python-build-standalone use zstd tarballs
  buildDeps: [tar_aa_id, zstd_aa_id],
  platforms: osXarch(["linux", "darwin", "windows"], ["x86_64", "aarch64"]),
};

const confValidator = zod.object({
  releaseTag: zod.string().nullish(),
}).passthrough();

export type CpythonBsInstallConf =
  & InstallConfigSimple
  & GithubReleasesInstConf
  & zod.input<typeof confValidator>;

export default function conf(
  config: CpythonBsInstallConf = {},
) {
  return {
    ...readGhVars(),
    ...config,
    port: manifest,
  };
}

export class Port extends PortBase {
  repoOwner = "indygreg";
  repoName = "python-build-standalone";
  override execEnv(
    args: PortArgsBase,
  ): Record<string, string> | Promise<Record<string, string>> {
    return {
      REAL_PYTHON_EXEC_PATH: $.path(args.installPath).join("bin").join(
        "python3",
      ).toString(),
    };
  }

  override latestStable(args: ListAllArgs): Promise<string> {
    return defaultLatestStable(this, args);
  }

  async latestMeta(headers: Record<string, string>) {
    const meta = await $.withRetries({
      count: 10,
      delay: $.exponentialBackoff(1000),
      action: async () =>
        await $.request(
          `https://raw.githubusercontent.com/${this.repoOwner}/${this.repoName}/latest-release/latest-release.json`,
        )
          .header(headers)
          .json() as {
            "version": number;
            "tag": string;
            "release_url": string;
            "asset_url_prefix": string;
          },
    });
    if (meta.version != 1) {
      throw new Error(
        `${this.repoOwner}/${this.repoName} have changed their latest release tag json version`,
        { cause: meta },
      );
    }
    return meta;
  }

  async listAll(args: ListAllArgs) {
    const headers = ghHeaders(args.config);
    const conf = confValidator.parse(args.config);
    let tag = conf.releaseTag;
    if (!tag) {
      const latestMeta = await this.latestMeta(headers);
      tag = latestMeta.tag;
    }
    // python-build-standalone builds all supported versions of python
    // on every release
    const metadata = await $.withRetries({
      count: 10,
      delay: $.exponentialBackoff(1000),
      action: async () =>
        await $.request(
          `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/tags/${tag}`,
        )
          .header(headers)
          .json() as {
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
      .sort((va, vb) => va.localeCompare(vb, undefined, { numeric: true }));
  }

  override async download(args: DownloadArgs) {
    const headers = ghHeaders(args.config);
    const conf = confValidator.parse(args.config);
    let tag = conf.releaseTag;
    if (!tag) {
      const latestMeta = await this.latestMeta(headers);
      tag = latestMeta.tag;
    }
    const { installVersion, platform } = args;
    const arch = platform.arch;
    let postfix = "pgo+lto-full";
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
        if (arch == "aarch64") {
          postfix = "lto-full";
        }
        break;
      case "darwin":
        os = "apple-darwin";
        break;
      default:
        throw new Error(`unsupported: ${platform}`);
    }
    const urls = [
      `https://github.com/${this.repoOwner}/${this.repoName}/releases/download/${tag}/cpython-${installVersion}+${tag}-${arch}-${os}-${postfix}.tar.zst`,
    ];
    await Promise.all(
      urls.map(dwnUrlOut)
        .map((obj) => downloadFile({ ...args, ...obj, headers })),
    );
  }

  override async install(args: InstallArgs) {
    const [_, fileDwnEntry] = await Array.fromAsync(
      $.path(args.downloadPath).walk(),
    );
    const fileDwnPath = fileDwnEntry.path.toString();
    await $`${
      depExecShimPath(tar_aa_id, "tar", args.depArts)
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
