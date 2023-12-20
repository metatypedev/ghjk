import { std_path, std_url } from "../../deps/common.ts";
import type {
  DownloadArgs,
  DownloadUrlsOut,
  ExecEnvArgs,
  InstallArgs,
  ListAllArgs,
  ListBinPathsArgs,
} from "./types.ts";
import logger from "../../utils/logger.ts";
import { $ } from "../../utils/mod.ts";

export abstract class PortBase {
  /// Enviroment variables for the install's environment
  execEnv(
    _args: ExecEnvArgs,
  ): Promise<Record<string, string>> | Record<string, string> {
    return {};
  }

  /// Paths to all the executables provided by an install.
  /// Glob paths will be expanded
  listBinPaths(
    args: ListBinPathsArgs,
  ): Promise<string[]> | string[] {
    return [
      std_path.joinGlobs([std_path.resolve(args.installPath, "bin"), "*"]),
    ];
  }

  /// Paths to all the shared libraries provided by an install.
  /// Glob paths will be expanded
  listLibPaths(
    args: ListBinPathsArgs,
  ): Promise<string[]> | string[] {
    return [
      std_path.joinGlobs([std_path.resolve(args.installPath, "lib"), "*"]),
    ];
  }

  /// Paths to all the header files provided by an install.
  /// Glob paths will be expanded
  listIncludePaths(
    args: ListBinPathsArgs,
  ): Promise<string[]> | string[] {
    return [
      std_path.joinGlobs([std_path.resolve(args.installPath, "include"), "*"]),
    ];
  }

  /// The latest version of a port to be used when no version
  /// is specified by a user.
  /// Will default to using the last itemr returned by [`listAll`]
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

  /// List all the versions availbile to be installed by this port.
  abstract listAll(args: ListAllArgs): Promise<string[]> | string[];

  /// FIXME: move this elsewhere
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
