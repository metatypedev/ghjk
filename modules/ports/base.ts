import { std_path, std_url } from "../../deps/common.ts";
import {
  type DownloadArgs,
  type DownloadUrlsOut,
  type ExecEnvArgs,
  type InstallArgs,
  type ListAllArgs,
  type ListBinPathsArgs,
} from "./types.ts";
import logger from "../../utils/logger.ts";
import { $ } from "../../utils/mod.ts";

export abstract class PortBase {
  execEnv(
    _args: ExecEnvArgs,
  ): Promise<Record<string, string>> | Record<string, string> {
    return {};
  }

  listBinPaths(
    args: ListBinPathsArgs,
  ): Promise<string[]> | string[] {
    return [
      std_path.joinGlobs([std_path.resolve(args.installPath, "bin"), "*"]),
    ];
  }

  listLibPaths(
    args: ListBinPathsArgs,
  ): Promise<string[]> | string[] {
    return [
      std_path.joinGlobs([std_path.resolve(args.installPath, "lib"), "*"]),
    ];
  }

  listIncludePaths(
    args: ListBinPathsArgs,
  ): Promise<string[]> | string[] {
    return [
      std_path.joinGlobs([std_path.resolve(args.installPath, "include"), "*"]),
    ];
  }

  latestStable(args: ListAllArgs): Promise<string> | string {
    return (async () => {
      logger().warning(
        `using default implementation of latestStable for port ${args.manifest.name}`,
      );
      const allVers = await this.listAll(args);
      if (allVers.length == 0) {
        throw new Error("no versions found");
      }
      return allVers[allVers.length - 1];
    })();
  }

  abstract listAll(args: ListAllArgs): Promise<string[]> | string[];

  downloadUrls(
    _args: DownloadArgs,
  ): Promise<DownloadUrlsOut> | DownloadUrlsOut {
    return [];
  }

  async download(args: DownloadArgs): Promise<void> {
    const urls = await this.downloadUrls(args);
    if (urls.length == 0) {
      throw new Error(
        `"downloadUrls" returned empty array when using default download impl: ` +
          `override "download" to an empty function if your port has no download step`,
      );
    }
    await Promise.all(urls.map(async (item) => {
      await downloadFile(args, item);
    }));
    logger().debug("done downloading", urls);
  }

  abstract install(args: InstallArgs): Promise<void> | void;
}

/// This avoid re-downloading a file if it's already successfully downloaded before.
export async function downloadFile(
  env: DownloadArgs,
  args: {
    url: string;
    name?: string;
    mode?: number;
  },
) {
  const { name, mode, url } = {
    name: std_url.basename(args.url),
    mode: 0o666,
    ...args,
  };

  const fileDwnPath = $.path(env.downloadPath).join(name);
  if (await fileDwnPath.exists()) {
    logger().debug(`file ${name} already downloaded, skipping`);
    return;
  }
  const tmpFilePath = $.path(env.tmpDirPath).join(name);

  await $.request(url)
    .showProgress()
    .pipeToPath(tmpFilePath, { create: true, mode });

  await $.path(env.downloadPath).ensureDir();

  await tmpFilePath.copyFile(fileDwnPath);
}
