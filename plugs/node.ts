import {
  addInstallGlobal,
  depBinShimPath,
  DownloadArgs,
  downloadFile,
  ExecEnvArgs,
  InstallArgs,
  type InstallConfigBase,
  ListAllEnv,
  ListBinPathsArgs,
  type PlatformInfo,
  PlugBase,
  registerDenoPlugGlobal,
  removeFile,
  std_fs,
  std_path,
  std_url,
  workerSpawn,
} from "../plug.ts";
import * as std_plugs from "../std.ts";

// TODO: sanity check exports of all plugs
export const manifest = {
  name: "node@org",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [
    std_plugs.tar_aa,
  ],
};

registerDenoPlugGlobal(manifest, () => new Plug());

// FIXME: improve multi platform support story
export default function install({ version }: InstallConfigBase = {}) {
  addInstallGlobal({
    plugName: manifest.name,
    version,
  });
}

export class Plug extends PlugBase {
  manifest = manifest;

  execEnv(args: ExecEnvArgs) {
    return {
      NODE_PATH: args.installPath,
    };
  }

  // we wan't to avoid adding libraries found by default at /lib
  // to PATHs as they're just node_module sources
  listLibPaths(env: ListBinPathsArgs): string[] {
    return [];
  }

  async listAll(_env: ListAllEnv) {
    const metadataRequest = await fetch(`https://nodejs.org/dist/index.json`);
    const metadata = await metadataRequest.json() as { version: string }[];

    const versions = metadata.map((v) => v.version);
    // sort them numerically to make sure version 0.10.0 comes after 0.2.9
    return versions.sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
  }

  async download(args: DownloadArgs) {
    await downloadFile(args, artifactUrl(args.installVersion, args.platform));
  }

  async install(args: InstallArgs) {
    const fileName = std_url.basename(
      artifactUrl(args.installVersion, args.platform),
    );
    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);
    await workerSpawn([
      depBinShimPath(std_plugs.tar_aa, "tar", args.depShims),
      "xf",
      fileDwnPath,
      `--directory=${args.tmpDirPath}`,
    ]);

    if (await std_fs.exists(args.installPath)) {
      await removeFile(args.installPath, { recursive: true });
    }

    await std_fs.copy(
      std_path.resolve(
        args.tmpDirPath,
        std_path.basename(fileDwnPath, ".tar.xz"),
      ),
      args.installPath,
    );
  }
}

// node distribute archives that contain the binary, ecma source for npm/npmx/corepack, include source files and more
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
      os = "linux";
      break;
    case "darwin":
      os = "darwin";
      break;
    default:
      throw new Error(`unsupported os: ${platform.arch}`);
  }
  return `https://nodejs.org/dist/${installVersion}/node-${installVersion}-${os}-${arch}.tar.xz`;
  // NOTE: we use xz archives which are smaller than gz archives
}
