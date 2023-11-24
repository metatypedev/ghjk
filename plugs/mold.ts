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
import * as std_plugs from "../std.ts";

const manifest = {
  name: "mold@ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [
    std_plugs.tar_aa,
  ],
};

registerDenoPlugGlobal(manifest, () => new Plug());

export default function install(config: InstallConfigBase = {}) {
  addInstallGlobal({
    plugName: manifest.name,
    ...config,
  });
}

const repoOwner = "rui314";
const repoName = "mold";
const repoAddress = `https://github.com/${repoOwner}/${repoName}`;

export class Plug extends PlugBase {
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

    await workerSpawn([
      depBinShimPath(std_plugs.tar_aa, "tar", args.depShims),
      "xf",
      fileDwnPath,
      `--directory=${args.tmpDirPath}`,
    ]);

    if (await std_fs.exists(args.installPath)) {
      await removeFile(args.installPath, { recursive: true });
    }

    const dirs = [];
    for await (
      const entry of std_fs.expandGlob(
        std_path.joinGlobs([args.tmpDirPath, "*"]),
      )
    ) {
      dirs.push(entry);
    }
    if (dirs.length != 1 || !dirs[0].isDirectory) {
      throw new Error("unexpected archive contents");
    }
    await std_fs.copy(
      dirs[0].path,
      args.installPath,
    );
  }
}

function downloadUrl(installVersion: string, platform: PlatformInfo) {
  if (platform.os == "linux") {
    const os = "linux";
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
    return `${repoAddress}/releases/download/${installVersion}/${repoName}-${installVersion.startsWith("v") ? installVersion.slice(1) : installVersion
      }-${arch}-${os}.tar.gz`;
  } else {
    throw new Error(`unsupported os: ${platform.os}`);
  }
}
