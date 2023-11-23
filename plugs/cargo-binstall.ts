import {
  addInstallGlobal,
  depBinShimPath,
  DownloadArgs,
  downloadFile,
  InstallArgs,
  type InstallConfigBase,
  type PlatformInfo,
  PlugBase,
  registerDenoPlugGlobal,
  removeFile,
  std_fs,
  std_path,
  std_url,
  workerSpawn,
} from "../plug.ts";
// FIXME: find a better way to expose std_plug.plug_Id
// that allows standard plugs to depend on each other
// import * as std_plugs from "../std.ts";

const tar_aa_id = {
  id: "tar@aa",
};

export const manifest = {
  name: "cargo-binstall@ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [tar_aa_id],
};

registerDenoPlugGlobal(manifest, () => new Plug());

export default function cargo_binstall(config: InstallConfigBase = {}) {
  addInstallGlobal({
    plugName: manifest.name,
    ...config,
  });
}

const repoAddress = "https://github.com/cargo-bins/cargo-binstall";

export class Plug extends PlugBase {
  manifest = manifest;

  listBinPaths(): string[] {
    return ["cargo-binstall", "detect-targets", "detect-wasi"];
  }

  async listAll() {
    const metadataRequest = await fetch(
      `https://index.crates.io/ca/rg/cargo-binstall`,
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
    await downloadFile(args, downloadUrl(args.installVersion, args.platform));
  }

  async install(args: InstallArgs) {
    const fileName = std_url.basename(
      downloadUrl(args.installVersion, args.platform),
    );
    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);

    await workerSpawn([
      depBinShimPath(tar_aa_id, "tar", args.depShims),
      "xf",
      fileDwnPath,
      `--directory=${args.tmpDirPath}`,
    ]);

    if (await std_fs.exists(args.installPath)) {
      await removeFile(args.installPath, { recursive: true });
    }

    await std_fs.copy(
      args.tmpDirPath,
      args.installPath,
    );
  }
}

function downloadUrl(installVersion: string, platform: PlatformInfo) {
  let arch;
  switch (platform.arch) {
    case "x86_64":
      arch = "x86_64";
      break;
    case "aarch64":
      arch = "aarch64";
      break;
    default:
      throw new Error(`unsupported arch: ${platform.arch}`);
  }
  if (platform.os == "darwin") {
    return `${repoAddress}/releases/download/v${installVersion}/cargo-binstall-${arch}-apple-darwin.full.zip`;
  } else if (platform.os == "linux") {
    // TODO: support for ubuntu/debian versions
    // we'll need a way to expose that to plugs
    const os = "unknown-linux-musl";
    // NOTE: xz archives are available for linux downloads
    return `${repoAddress}/releases/download/v${installVersion}/cargo-binstall-${arch}-${os}.full.tgz`;
  } else {
    throw new Error(`unsupported os: ${platform.os}`);
  }
}
