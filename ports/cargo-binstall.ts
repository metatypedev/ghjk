import {
  $,
  addInstallGlobal,
  DownloadArgs,
  downloadFile,
  InstallArgs,
  type InstallConfigSimple,
  type PlatformInfo,
  PortBase,
  registerDenoPortGlobal,
  std_fs,
  std_path,
  std_url,
  unarchive,
} from "../port.ts";

export const manifest = {
  ty: "denoWorker" as const,
  name: "cargo-binstall@ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
};

registerDenoPortGlobal(manifest, () => new Port());

export default function install(config: InstallConfigSimple = {}) {
  addInstallGlobal({
    portName: manifest.name,
    ...config,
  });
}

const repoOwner = "cargo-bins";
const repoName = "cargo-binstall";
const repoAddress = `https://github.com/${repoOwner}/${repoName}`;

export class Port extends PortBase {
  manifest = manifest;

  async listAll() {
    const metadataText = await $.request(
      `https://index.crates.io/ca/rg/cargo-binstall`,
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
    await downloadFile(args, downloadUrl(args.installVersion, args.platform));
  }

  async install(args: InstallArgs) {
    const fileName = std_url.basename(
      downloadUrl(args.installVersion, args.platform),
    );
    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);

    await unarchive(fileDwnPath, args.tmpDirPath);

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }
    await std_fs.copy(
      args.tmpDirPath,
      std_path.resolve(args.installPath, "bin"),
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
    // NOTE: the archive file name extensions are different from os to os
    return `${repoAddress}/releases/download/v${installVersion}/${repoName}-${arch}-apple-darwin.full.zip`;
  } else if (platform.os == "linux") {
    // TODO: support for ubuntu/debian versions
    // we'll need a way to expose that to ports
    const os = "unknown-linux-musl";
    return `${repoAddress}/releases/download/v${installVersion}/${repoName}-${arch}-${os}.full.tgz`;
  } else {
    throw new Error(`unsupported os: ${platform.os}`);
  }
}
