import {
  addInstallGlobal,
  denoWorkerPlug,
  depBinShimPath,
  DownloadArgs,
  downloadFile,
  ExecEnvArgs,
  InstallArgs,
  type InstallConfigBase,
  ListAllEnv,
  ListBinPathsArgs,
  logger,
  type PlatformInfo,
  Plug,
  registerDenoPlugGlobal,
  removeFile,
  std_fs,
  std_path,
  std_url,
  workerSpawn,
} from "../plug.ts";
import * as std_plugs from "../std.ts";

const manifest = {
  name: "node",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [
    std_plugs.tar_aa,
  ],
};

// FIXME: improve multi platform support story
if (Deno.build.os != "darwin" && Deno.build.os != "linux") {
  throw Error(`unsupported os: ${Deno.build.os}`);
}

registerDenoPlugGlobal(manifest);

export default function node({ version }: InstallConfigBase = {}) {
  addInstallGlobal({
    plugName: manifest.name,
    version,
  });
}

denoWorkerPlug(
  new class extends Plug {
    manifest = manifest;

    execEnv(args: ExecEnvArgs) {
      return {
        NODE_PATH: args.installPath,
      };
    }

    listBinPaths(_args: ListBinPathsArgs) {
      return [
        "bin/node",
        "bin/npm",
        "bin/npx",
      ];
    }

    async latestStable(_args: ListAllEnv): Promise<string> {
      const metadataRequest = await fetch(`https://nodejs.org/dist/index.json`);
      const metadata = await metadataRequest.json();

      if (!Array.isArray(metadata)) {
        throw Error("invalid data received from index");
      }
      return metadata.find((ver) => ver.lts).version;
    }

    async listAll(_env: ListAllEnv) {
      const metadataRequest = await fetch(`https://nodejs.org/dist/index.json`);
      const metadata = await metadataRequest.json();

      const versions = metadata.map((v: any) => v.version);
      versions.sort();

      logger().debug(versions);
      return versions;
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

      await std_fs.copy(
        std_path.resolve(
          args.tmpDirPath,
          std_path.basename(fileDwnPath, ".tar.xz"),
        ),
        args.installPath,
      );
    }
  }(),
);

function downloadUrl(installVersion: string, platform: PlatformInfo) {
  // TODO: download file
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
      throw Error(`unsupported arch: ${platform.arch}`);
  }
  switch (platform.os) {
    case "linux":
      os = "linux";
      break;
    case "darwin":
      os = "darwin";
      break;
    default:
      throw Error(`unsupported os: ${platform.arch}`);
  }
  return `https://nodejs.org/dist/${installVersion}/node-${installVersion}-${os}-${arch}.tar.xz`;
  // NOTE: we use xz archives which are smaller than gz archives
}
