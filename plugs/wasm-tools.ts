import {
  addInstallGlobal,
  depBinShimPath,
  type DownloadArgs,
  InstallArgs,
  type InstallConfigBase,
  logger,
  PlugBase,
  registerDenoPlugGlobal,
  removeFile,
  spawn,
  std_fs,
  std_path,
} from "../plug.ts";
import * as std_plugs from "../std.ts";

const manifest = {
  name: "wasm-tools@cbinst",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [
    std_plugs.cbin_ghrel,
  ],
};

registerDenoPlugGlobal(manifest, () => new Plug());

export default function install(config: InstallConfigBase = {}) {
  addInstallGlobal({
    plugName: manifest.name,
    ...config,
  });
}

export class Plug extends PlugBase {
  manifest = manifest;

  async listAll() {
    const metadataRequest = await fetch(
      `https://index.crates.io/wa/sm/wasm-tools`,
    );
    const metadataText = await metadataRequest.text();
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
    const fileName = "wasm-tools";
    if (
      await std_fs.exists(std_path.resolve(args.downloadPath, fileName))
    ) {
      logger().debug(
        `file ${fileName} already downloaded, skipping whole download`,
      );
      return;
    }
    await spawn([
      depBinShimPath(std_plugs.cbin_ghrel, "cargo-binstall", args.depShims),
      "wasm-tools",
      `--version`,
      args.installVersion,
      `--install-path`,
      args.tmpDirPath,
      `--no-confirm`,
      `--disable-strategies`,
      `compile`,
      `--no-track`,
    ]);
    await std_fs.copy(
      args.tmpDirPath,
      args.downloadPath,
    );
    await std_fs.ensureDir(args.downloadPath);
  }

  async install(args: InstallArgs) {
    if (await std_fs.exists(args.installPath)) {
      await removeFile(args.installPath, { recursive: true });
    }
    await std_fs.copy(
      args.downloadPath,
      std_path.resolve(args.installPath, "bin"),
    );
  }
}
