import {
  addInstallGlobal,
  DownloadArgs,
  downloadFile,
  ExecEnvArgs,
  InstallArgs,
  type InstallConfigBase,
  type PlatformInfo,
  PlugBase,
  registerDenoPlugGlobal,
  removeFile,
  std_fs,
  std_path,
  std_url,
  unarchive,
} from "../plug.ts";

const manifest = {
  name: "wasmedge@ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
};

registerDenoPlugGlobal(manifest, () => new Plug());

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
export default function install(config: InstallConfigBase = {}) {
  addInstallGlobal({
    plugName: manifest.name,
    ...config,
  });
}

const repoOwner = "WasmEdge";
const repoName = "WasmEdge";
const repoAddress = `https://github.com/${repoOwner}/${repoName}`;

export class Plug extends PlugBase {
  manifest = manifest;

  execEnv(args: ExecEnvArgs) {
    return {
      WASMEDGE_LIB_DIR: std_path.resolve(args.installPath, "lib"),
    };
  }

  listLibPaths(): string[] {
    return ["lib*/*"];
  }

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
    // NOTE: this downloads a 1+ meg json
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
        throw new Error(`unsupported arch: ${platform.arch}`);
    }
    return `${repoAddress}/releases/download/${installVersion}/${repoName}-${installVersion}-${os}_${arch}.tar.gz`;
  } else {
    throw new Error(`unsupported os: ${platform.os}`);
  }
}
