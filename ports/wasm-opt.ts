import {
  addInstallGlobal,
  depBinShimPath,
  type DownloadArgs,
  InstallArgs,
  type InstallConfigSimple,
  logger,
  PortBase,
  registerDenoPortGlobal,
  removeFile,
  spawn,
  std_fs,
  std_path,
} from "../port.ts";
import * as std_ports from "../modules/ports/std.ts";

const manifest = {
  ty: "denoWorker" as const,
  name: "wasm-opt@cbinst",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [
    std_ports.cbin_ghrel,
  ],
};

registerDenoPortGlobal(manifest, () => new Port());

export default function install(config: InstallConfigSimple = {}) {
  addInstallGlobal({
    portName: manifest.name,
    ...config,
  });
}

export class Port extends PortBase {
  manifest = manifest;

  async listAll() {
    const metadataRequest = await fetch(
      `https://index.crates.io/wa/sm/wasm-opt`,
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
    const fileName = "wasm-opt";
    if (
      await std_fs.exists(std_path.resolve(args.downloadPath, fileName))
    ) {
      logger().debug(
        `file ${fileName} already downloaded, skipping whole download`,
      );
      return;
    }
    await spawn([
      depBinShimPath(std_ports.cbin_ghrel, "cargo-binstall", args.depShims),
      "wasm-opt",
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
