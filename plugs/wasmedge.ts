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
  type PlatformInfo,
  Plug,
  registerDenoPlugGlobal,
  removeFile,
  spawnOutput,
  std_fs,
  std_path,
  std_url,
  workerSpawn,
} from "../plug.ts";
import * as std_plugs from "../std.ts";

const manifest = {
  name: "wasmedge",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [
    std_plugs.tar_aa,
    std_plugs.git_aa,
  ],
};

// FIXME: improve multi platform support story
if (Deno.build.os != "darwin" && Deno.build.os != "linux") {
  throw Error(`unsupported os: ${Deno.build.os}`);
}

registerDenoPlugGlobal(manifest);
/*
const supportedExtensions = ["tensorflow" as const, "image" as const];

type DeArray<A> = A extends Array<infer T> ? T : A;

type SupportedExtensions = DeArray<typeof supportedExtensions>;

const supportedPlugins = [
  "wasi_nn-openvino" as const,
  "wasi_crypto" as const,
  "wasi_nn-pytorch" as const,
  "wasi_nn-tensorflowlite" as const,
  "wasi_nn-ggml" as const,
  "wasi_nn-ggml-cuda" as const,
  "wasi_nn-ggml-cuda" as const,
  "wasmedge_tensorflow" as const,
  "wasmedge_tensorflowlite" as const,
  "wasmedge_image" as const,
  "wasmedge_rustls" as const,
  "wasmedge_bpf" as const,
];
 */
export default function wasmedge(config: InstallConfigBase = {}) {
  addInstallGlobal({
    plugName: manifest.name,
    ...config,
  });
}

const repoAddress = "https://github.com/WasmEdge/WasmEdge";

denoWorkerPlug(
  new class extends Plug {
    manifest = manifest;

    execEnv(args: ExecEnvArgs) {
      return {
        WASMEDGE_LIB_DIR: std_path.resolve(args.installPath, "lib"),
      };
    }

    listLibPaths(): string[] {
      return ["lib*/*"];
    }

    async listAll(args: ListAllEnv) {
      const fullOut = await spawnOutput([
        depBinShimPath(std_plugs.git_aa, "git", args.depShims),
        "ls-remote",
        "--refs",
        "--tags",
        repoAddress,
      ]);

      return fullOut
        .split("\n")
        .filter((str) => str.length > 0)
        .map((line) => line.split("/")[2])
        // filter out tags that aren't wasmedge versions
        .filter((str) => str.match(/^\d+\.\d+\.\d+/))
        // append X to versions with weird strings like 0.10.1-rc or 0.10.1-alpha
        // to make sure they get sorted before the clean releases
        .map((ver) => ver.match(/-/) ? ver : `${ver}X`)
        // sort them numerically to make sure version 0.10.0 comes after 0.2.9
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        // get rid of the X we appended
        .map((ver) => ver.replace(/X$/, ""));
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

      const dirs = await Array
        .fromAsync(
          std_fs.expandGlob(std_path.joinGlobs([args.tmpDirPath, "*"])),
        );
      if (dirs.length != 1 || !dirs[0].isDirectory) {
        throw Error("unexpected archive contents");
      }
      await std_fs.copy(
        dirs[0].path,
        args.installPath,
      );
    }
  }(),
);

function downloadUrl(installVersion: string, platform: PlatformInfo) {
  if (platform.os == "darwin") {
    let arch;
    switch (platform.arch) {
      case "x86_64":
        arch = "x86_64";
        break;
      case "aarch64":
        arch = "arm64";
        break;
      default:
        throw Error(`unsupported arch: ${platform.arch}`);
    }
    return `${repoAddress}/releases/download/${installVersion}/WasmEdge-${installVersion}-${platform.os}_${arch}.tar.gz`;
  } else if (platform.os == "linux") {
    // TODO: support for ubuntu/debian versions
    // we'll need a way to expose that to plugs
    const os = "manylinux2014";
    let arch;
    switch (platform.arch) {
      case "x86_64":
        arch = "x86_64";
        break;
      case "aarch64":
        arch = "aarch64"; // NOTE: arch is different from darwin releases
        break;
      default:
        throw Error(`unsupported arch: ${platform.arch}`);
    }
    // NOTE: xz archives are available for linux downloads
    return `${repoAddress}/releases/download/${installVersion}/WasmEdge-${installVersion}-${os}_${arch}.tar.xz`;
  } else {
    throw Error(`unsupported os: ${platform.os}`);
  }
}
