import { std_path } from "../../deps/common.ts";
import type {
  DownloadArgs,
  ExecEnvArgs,
  InstallArgs,
  ListAllArgs,
  ListBinPathsArgs,
} from "./types.ts";
import logger from "../../utils/logger.ts";

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

  /// Download all files necessary for installation
  abstract download(args: DownloadArgs): Promise<void> | void;

  /// Do.
  abstract install(args: InstallArgs): Promise<void> | void;
}
