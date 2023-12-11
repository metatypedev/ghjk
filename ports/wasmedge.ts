import {
  $,
  addInstallGlobal,
  depBinShimPath,
  DownloadArgs,
  downloadFile,
  ExecEnvArgs,
  GithubReleasePort,
  InstallArgs,
  type InstallConfigSimple,
  type PlatformInfo,
  registerDenoPortGlobal,
  std_fs,
  std_path,
  std_url,
} from "../port.ts";
import * as std_ports from "../modules/ports/std.ts";

const manifest = {
  ty: "denoWorker" as const,
  name: "wasmedge@ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [
    std_ports.tar_aa,
  ],
};

registerDenoPortGlobal(manifest, () => new Port());

// TODO: wasmedge extension and plugin support
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
export default function install(config: InstallConfigSimple = {}) {
  addInstallGlobal({
    portName: manifest.name,
    ...config,
  });
}

const repoOwner = "WasmEdge";
const repoName = "WasmEdge";
const repoAddress = `https://github.com/${repoOwner}/${repoName}`;

export class Port extends GithubReleasePort {
  manifest = manifest;
  repoName = repoName;
  repoOwner = repoOwner;

  execEnv(args: ExecEnvArgs) {
    return {
      WASMEDGE_LIB_DIR: std_path.resolve(args.installPath, "lib"),
      WASMEDGE_INCLUDE_DIR: std_path.resolve(args.installPath, "include"),
    };
  }

  listLibPaths(): string[] {
    return ["lib*/*"];
  }

  async download(args: DownloadArgs) {
    await downloadFile(args, downloadUrl(args.installVersion, args.platform));
  }

  async install(args: InstallArgs) {
    const fileName = std_url.basename(
      downloadUrl(args.installVersion, args.platform),
    );
    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);

    await $`${
      depBinShimPath(std_ports.tar_aa, "tar", args.depShims)
    } xf ${fileDwnPath} --directory=${args.tmpDirPath}`;

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
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
        throw new Error(`unsupported arch: ${platform.arch}`);
    }
    return `${repoAddress}/releases/download/${installVersion}/${repoName}-${installVersion}-${platform.os}_${arch}.tar.gz`;
  } else if (platform.os == "linux") {
    // TODO: support for ubuntu/debian versions
    // we'll need a way to expose that to ports
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
        throw new Error(`unsupported arch: ${platform.arch}`);
    }
    return `${repoAddress}/releases/download/${installVersion}/${repoName}-${installVersion}-${os}_${arch}.tar.gz`;
  } else {
    throw new Error(`unsupported os: ${platform.os}`);
  }
}
