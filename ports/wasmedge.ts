import {
  $,
  depExecShimPath,
  DownloadArgs,
  dwnUrlOut,
  ExecEnvArgs,
  GithubReleasePort,
  InstallArgs,
  InstallConfigSimple,
  osXarch,
  std_fs,
  std_path,
} from "../src/deno_ports/mod.ts";
import * as std_ports from "../src/sys_deno/ports/std.ts";
import { GithubReleasesInstConf, readGhVars } from "../src/deno_ports/ghrel.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "wasmedge_ghrel",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  buildDeps: [
    std_ports.tar_aa,
  ],
  platforms: osXarch(["linux", "darwin"], ["aarch64", "x86_64"]),
};

export default function conf(
  config: InstallConfigSimple & GithubReleasesInstConf = {},
) {
  return {
    ...readGhVars(),
    ...config,
    port: manifest,
  };
}

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

export class Port extends GithubReleasePort {
  repoOwner = "WasmEdge";
  repoName = "WasmEdge";

  override execEnv(args: ExecEnvArgs) {
    return {
      WASMEDGE_DIR: args.installPath,
      // WASMEDGE_LIB_DIR: std_path.resolve(args.installPath, "lib64"),
      // WASMEDGE_INCLUDE_DIR: std_path.resolve(args.installPath, "include"),
    };
  }

  override listLibPaths(): string[] {
    return ["lib*/*"];
  }

  override downloadUrls(args: DownloadArgs) {
    const { installVersion, platform } = args;
    let fileName;
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
      fileName =
        `${this.repoName}-${installVersion}-${platform.os}_${arch}.tar.gz`;
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
      fileName = `${this.repoName}-${installVersion}-${os}_${arch}.tar.gz`;
    } else {
      throw new Error(`unsupported os: ${platform.os}`);
    }

    return [
      this.releaseArtifactUrl(
        installVersion,
        fileName,
      ),
    ].map(dwnUrlOut);
  }

  override async install(args: InstallArgs) {
    const [{ name: fileName }] = this.downloadUrls(args);
    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);

    await $`${
      depExecShimPath(std_ports.tar_aa, "tar", args.depArts)
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
