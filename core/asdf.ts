import {
  type AsdfInstallConfigX,
  type DepShims,
  DownloadArgs,
  InstallArgs,
  ListAllArgs,
  ListBinPathsArgs,
  PlugBase,
} from "./types.ts";
import {
  depBinShimPath,
  pathWithDepShims,
  spawn,
  spawnOutput,
  getInstallId
} from "./utils.ts";
// import * as std_plugs from "../std.ts";
import { std_fs, std_path } from "../deps/common.ts";

const curl_aa_id = {
  id: "curl@aa",
};

const git_aa_id = {
  id: "git@aa",
};

export const manifest = {
  name: "asdf@asdf",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  // deps: [std_plugs.tar_aa, std_plugs.git_aa],
  deps: [curl_aa_id, git_aa_id],
};

export class AsdfPlug extends PlugBase {
  manifest = manifest;
  constructor(
    public asdfDir: string,
    public pluginDir: string,
    public config: AsdfInstallConfigX,
  ) {
    super();
  }
  static async init(
    envDir: string,
    installConfig: AsdfInstallConfigX,
    depShims: DepShims,
  ) {
    const asdfDir = std_path.resolve(envDir, "asdf");
    const installId = getInstallId(installConfig);

    const pluginDir = std_path.resolve(asdfDir, installId);
    if (!await std_fs.exists(pluginDir)) {
      const tmpCloneDirPath = await Deno.makeTempDir({
        prefix: `ghjk_asdf_clone_${installId}_`,
      });
      await spawn(
        [
          depBinShimPath(git_aa_id, "git", depShims),
          "clone",
          installConfig.plugRepo,
          "--depth",
          "1",
          tmpCloneDirPath,
        ],
      );
      await std_fs.copy(
        tmpCloneDirPath,
        pluginDir,
      );
      void Deno.remove(tmpCloneDirPath, { recursive: true });
    }
    return new AsdfPlug(asdfDir, pluginDir, installConfig);
  }

  async listAll(_args: ListAllArgs): Promise<string[]> {
    const out = await spawnOutput([
      std_path.resolve(this.pluginDir, "bin", "list-all"),
    ]);
    return out.split(" ").filter((str) => str.length > 0).map((str) =>
      str.trim()
    );
  }

  async latestStable(args: ListAllArgs): Promise<string> {
    const binPath = std_path.resolve(this.pluginDir, "bin", "latest-stable");
    if (!await std_fs.exists(binPath)) {
      return super.latestStable(args);
    }
    const out = await spawnOutput([binPath], {
      env: {
        PATH: pathWithDepShims(args.depShims),
        ASDF_INSTALL_TYPE: this.config.installType,
        // FIXME: asdf requires these vars for latest-stable. this makes no sense!
        ASDF_INSTALL_VERSION: this.config.version ?? "",
        // ASDF_INSTALL_PATH: args.installPath,
      },
    });
    return out.trim();
  }

  async listBinPaths(args: ListBinPathsArgs): Promise<string[]> {
    const binPath = std_path.resolve(this.pluginDir, "bin", "list-bin-paths");
    if (!await std_fs.exists(binPath)) {
      return super.listBinPaths(args);
    }

    const out = await spawnOutput([binPath], {
      env: {
        PATH: pathWithDepShims(args.depShims),
        ASDF_INSTALL_TYPE: this.config.installType,
        ASDF_INSTALL_VERSION: args.installVersion,
        ASDF_INSTALL_PATH: args.installPath,
      },
    });
    return out.split(" ").filter((str) => str.length > 0).map((str) =>
      str.trim()
    );
  }

  async download(args: DownloadArgs) {
    const binPath = std_path.resolve(this.pluginDir, "bin", "download");
    // some plugins don't have a download script despite the spec
    if (!await std_fs.exists(binPath)) {
      return;
    }
    await spawn([
      std_path.resolve(this.pluginDir, "bin", "download"),
    ], {
      env: {
        PATH: pathWithDepShims(args.depShims),
        ASDF_INSTALL_TYPE: this.config.installType,
        ASDF_INSTALL_VERSION: args.installVersion,
        ASDF_INSTALL_PATH: args.installPath,
        ASDF_DOWNLOAD_PATH: args.downloadPath,
      },
    });
  }
  async install(args: InstallArgs) {
    await spawn([
      std_path.resolve(this.pluginDir, "bin", "install"),
    ], {
      env: {
        PATH: pathWithDepShims(args.depShims),
        ASDF_INSTALL_TYPE: this.config.installType,
        ASDF_INSTALL_VERSION: args.installVersion,
        ASDF_INSTALL_PATH: args.installPath,
        ASDF_DOWNLOAD_PATH: args.downloadPath,
        ASDF_CONCURRENCY: args.availConcurrency.toString(),
      },
    });
  }
}