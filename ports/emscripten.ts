import {
  $,
  depExecShimPath,
  DownloadArgs,
  ExecEnvArgs,
  InstallArgs,
  InstallConfigSimple,
  ListAllArgs,
  ListBinPathsArgs,
  osXarch,
  PortBase,
  std_fs,
  std_path,
} from "../port.ts";
import * as std_ports from "../modules/ports/std.ts";

const git_aa_id = {
  name: "git_aa",
};

const repo = "https://github.com/emscripten-core/emsdk.git";

export const manifest = {
  ty: "denoWorker@v1" as const,
  name: "emsdk",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [std_ports.git_aa],
  platforms: osXarch(["linux", "darwin", "windows"], ["x86_64", "aarch64"]),
};

export default function conf(config: InstallConfigSimple = {}) {
  return {
    ...config,
    port: manifest,
  };
}

export abstract class Port extends PortBase {
  async execEnv(args: ExecEnvArgs): Promise<Record<string, string>> {
    const llvm = std_path.resolve(args.installPath, "upstream/bin").toString();
    const binaryen = std_path.resolve(args.installPath, "upstream").toString();
    const res: Record<string, string> = {
      EMSDK: std_path.resolve(args.installPath).toString(),
      EM_CONFIG: std_path.resolve(args.installPath, ".emscripten").toString(),
      EMSCRIPTEN_ROOT: std_path
        .resolve(args.installPath, "upstream", "emscripten")
        .toString(),
      EMCC_CACHE: std_path
        .resolve(args.installPath, "upstream/emscripten/cache")
        .toString(),
      LLVM: llvm,
      LLVM_ROOT: llvm,
      EM_LLVM_ROOT: llvm,
      BINARYEN: binaryen,
      BINARYEN_ROOT: binaryen,
      EM_BINARYEN_ROOT: binaryen,
    };
    const node = std_path.resolve(args.installPath, "node").toString();
    if (await $.path(node).exists()) {
      for await (
        const entry of std_fs.expandGlob(std_path.joinGlobs([node, "*"]))
      ) {
        console.log(entry);
        const nodejs = std_path.resolve(entry.path, "bin/nodejs").toString();
        res["EMSDK_NODE"] = nodejs;
        res["NODE_JS"] = nodejs;
      }
    }
    return res;
  }

  listBinPaths(args: ListBinPathsArgs): Promise<string[]> | string[] {
    return [
      std_path.joinGlobs([std_path.resolve(args.installPath), "*"]),
      std_path.joinGlobs([
        std_path.resolve(args.installPath, "upstream", "emscripten"),
        "em*",
      ]),
    ];
  }

  listAll(_args: ListAllArgs): Promise<string[]> | string[] {
    // TODO
    return ["latest"];
  }

  async download(args: DownloadArgs) {
    const cmd = depExecShimPath(git_aa_id, "git", args.depArts);
    if (await $.path(args.downloadPath).join(".git").exists()) {
      await $`${cmd} pull`;
    } else {
      await $.path(args.downloadPath)
        .remove({ recursive: true })
        .catch(() => {});
      await $`${cmd} clone ${repo} --depth 1 ${args.downloadPath} `;
    }
  }

  async install(args: InstallArgs) {
    const installPath = $.path(args.installPath);
    if (!(await installPath.exists())) {
      await std_fs.copy(args.downloadPath, installPath.toString());
    }

    const emsdk = installPath.join("emsdk").toString();
    await $`${emsdk} install latest`;
  }
}
