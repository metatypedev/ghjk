import {
  addInstallGlobal,
  DownloadArgs,
  downloadFile,
  InstallArgs,
  type InstallConfigSimple,
  type PlatformInfo,
  PortBase,
  registerDenoPortGlobal,
  removeFile,
  std_fs,
  std_path,
  std_url,
  unarchive,
} from "../port.ts";

const manifest = {
  ty: "denoWorker" as const,
  name: "ruff@ghrel",
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

const repoOwner = "astral-sh";
const repoName = "ruff";
const repoAddress = `https://github.com/${repoOwner}/${repoName}`;

export class Port extends PortBase {
  manifest = manifest;

  async latestStable(): Promise<string> {
    const metadataRequest = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`,
    );

    const metadata = await metadataRequest.json() as {
      tag_name: string;
    };

    return metadata.tag_name;
  }

  async listAll() {
    const metadataRequest = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/releases`,
    );

    const metadata = await metadataRequest.json() as [{
      tag_name: string;
    }];

    return metadata.map((rel) => rel.tag_name).reverse();
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

    if (await std_fs.exists(args.installPath)) {
      await removeFile(args.installPath, { recursive: true });
    }
    await std_fs.copy(
      args.tmpDirPath,
      std_path.resolve(args.installPath, "bin"),
    );
    // await Deno.chmod(std_path.resolve(args.installPath, "bin", "ruff"), 0o700);
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
  let os;
  let ext;
  switch (platform.os) {
    case "linux":
      os = "unknown-linux-musl";
      ext = "tar.gz";
      break;
    case "darwin":
      os = "apple-darwin";
      ext = "tar.gz";
      break;
    case "windows":
      os = "pc-windows-msvc";
      ext = "zip";
      break;
    default:
      throw new Error(`unsupported arch: ${platform.arch}`);
  }
  return `${repoAddress}/releases/download/${installVersion}/${repoName}-${arch}-${os}.${ext}`;
}
