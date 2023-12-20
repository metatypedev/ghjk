import { type DownloadArgs, type InstallArgs } from "./mod.ts";
import { PortBase } from "./base.ts";
import { std_fs, std_path } from "../../deps/ports.ts";
import logger from "../../utils/logger.ts";
import { $, depExecShimPath } from "../../utils/mod.ts";
import * as std_ports from "./std.ts";

// TODO: convert to `AsdfPort` like abstraction
// this is a temporarary DRY up

export abstract class CargoBinstallPort extends PortBase {
  abstract crateName: string;

  binName() {
    return this.crateName;
  }

  async listAll() {
    const metadataText = await $.request(
      `https://index.crates.io/${this.crateName.slice(0, 2)}/${
        this.crateName.slice(2, 4)
      }/${this.crateName}`,
    ).text();
    const versions = metadataText
      .split("\n")
      .filter((str) => str.length > 0)
      .map((str) =>
        JSON.parse(str) as {
          vers: string;
        }
      );
    return versions.map((ver) => ver.vers);
  }

  async download(args: DownloadArgs) {
    const fileName = this.binName();
    if (await std_fs.exists(std_path.resolve(args.downloadPath, fileName))) {
      logger().debug(
        `file ${fileName} already downloaded, skipping whole download`,
      );
      return;
    }
    await $`${
      depExecShimPath(std_ports.cbin_ghrel, "cargo-binstall", args.depArts)
    }
      ${this.crateName} --version ${args.installVersion}
      --install-path ${args.tmpDirPath}
      --no-confirm --disable-strategies compile --no-track
    `;
    await std_fs.copy(
      args.tmpDirPath,
      args.downloadPath,
    );
  }

  async install(args: InstallArgs) {
    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }
    await std_fs.copy(
      args.downloadPath,
      installPath.join("bin").toString(),
    );
  }
}
