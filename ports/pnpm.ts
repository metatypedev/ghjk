import {
  addInstallGlobal,
  DownloadArgs,
  downloadFile,
  InstallArgs,
  type InstallConfigBase,
  ListAllArgs,
  type PlatformInfo,
  PortBase,
  registerDenoPlugGlobal,
  removeFile,
  std_fs,
  std_path,
  std_url,
} from "../port.ts";

export const manifest = {
  name: "pnpm@ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
};
registerDenoPlugGlobal(manifest, () => new Port());

export default function install({ version }: InstallConfigBase = {}) {
  addInstallGlobal({
    portName: manifest.name,
    version,
  });
}

class Port extends PortBase {
  manifest = manifest;

  async listAll(_env: ListAllArgs) {
    const metadataRequest = await fetch(
      `https://registry.npmjs.org/@pnpm/exe`,
      {
        headers: {
          // use abbreviated registry info which's still 500kb unzipped
          "Accept": "application/vnd.npm.install-v1+json",
        },
      },
    );
    const metadata = await metadataRequest.json() as {
      versions: Record<string, unknown>;
    };

    const versions = Object.keys(metadata.versions);
    return versions;
  }

  async download(args: DownloadArgs) {
    await downloadFile(
      args,
      artifactUrl(args.installVersion, args.platform),
      {
        mode: 0o700,
      },
    );
  }

  async install(args: InstallArgs) {
    const fileName = std_url.basename(
      artifactUrl(args.installVersion, args.platform),
    );
    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);

    if (await std_fs.exists(args.installPath)) {
      await removeFile(args.installPath, { recursive: true });
    }

    await std_fs.ensureDir(std_path.resolve(args.installPath, "bin"));
    await std_fs.copy(
      fileDwnPath,
      std_path.resolve(
        args.installPath,
        "bin",
        args.platform.os == "windows" ? "pnpm.exe" : "pnpm",
      ),
    );
  }
}

// pnpm distribute an executable directly
function artifactUrl(installVersion: string, platform: PlatformInfo) {
  let arch;
  let os;
  switch (platform.arch) {
    case "x86_64":
      arch = "x64";
      break;
    case "aarch64":
      arch = "arm64";
      break;
    default:
      throw new Error(`unsupported arch: ${platform.arch}`);
  }
  switch (platform.os) {
    case "linux":
      os = "linuxstatic";
      break;
    case "darwin":
      os = "macos";
      break;
    case "windows":
      os = "win";
      return `https://github.com/pnpm/pnpm/releases/download/v${installVersion}/pnpm-${os}-${arch}.exe`;
    default:
      throw new Error(`unsupported os: ${platform.arch}`);
  }
  return `https://github.com/pnpm/pnpm/releases/download/v${installVersion}/pnpm-${os}-${arch}`;
}
