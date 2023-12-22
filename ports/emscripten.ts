import {
  $,
  depExecShimPath,
  DownloadArgs,
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
  deps: [std_ports.git_aa], //, std_ports.cpy_bs_ghrel],
  platforms: osXarch(["linux", "darwin", "windows"], ["x86_64", "aarch64"]),
};

export default function conf(config: InstallConfigSimple = {}) {
  return {
    ...config,
    port: manifest,
  };
}

export abstract class Port extends PortBase {
  listBinPaths(args: ListBinPathsArgs): Promise<string[]> | string[] {
    return [
      std_path.joinGlobs([std_path.resolve(args.installPath, "bin"), "*"]),
      std_path.joinGlobs([
        std_path.resolve(args.installPath, "bin", "upstream", "emscripten"),
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
    if (await $.path(args.downloadPath).exists()) {
      await $`${cmd} pull`;
    } else {
      await $`${cmd} clone ${repo} --depth 1 ${args.downloadPath} `;
    }
  }

  async install(args: InstallArgs) {
    const installPath = $.path(args.installPath);
    if (!await installPath.exists()) {
      await std_fs.copy(args.downloadPath, installPath.join("bin").toString());
    }

    const emsdk = installPath.join("bin", "emsdk").toString();
    await $`${emsdk} install latest`;
    await $`${emsdk} activate latest`;
  }
}
