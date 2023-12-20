import {
  $,
  depExecShimPath,
  DownloadArgs,
  dwnUrlOut,
  ExecEnvArgs,
  InstallArgs,
  InstallConfigSimple,
  ListAllArgs,
  osXarch,
  PortBase,
  std_fs,
  std_path,
} from "../port.ts";

// FIXME: circular module resolution when one std_port imports another
const tar_aa_id = {
  name: "tar_aa",
};

// TODO: sanity check exports of all ports
export const manifest = {
  ty: "denoWorker@v1" as const,
  name: "node_org",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  // FIXME: tar doens't support windows
  // TODO: platform disambiguated deps
  deps: [tar_aa_id],
  // NOTE: node supports more archs than deno but we can't include it here
  platforms: osXarch(["linux", "darwin", "windows"], ["aarch64", "x86_64"]),
};

// FIXME: improve multi platform support story
export default function conf(config: InstallConfigSimple = {}) {
  return {
    ...config,
    port: manifest,
  };
}

export class Port extends PortBase {
  execEnv(args: ExecEnvArgs) {
    return {
      NODE_PATH: args.installPath,
    };
  }

  // we wan't to avoid adding libraries found by default at /lib
  // to PATHs as they're just node_module sources
  listLibPaths(): string[] {
    return [];
  }

  async listAll(_env: ListAllArgs) {
    const metadata = await $.request(`https://nodejs.org/dist/index.json`)
      .json() as { version: string }[];

    const versions = metadata.map((v) => v.version);
    // sort them numerically to make sure version 0.10.0 comes after 0.2.9
    return versions.sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
  }

  // node distribute archives that contain the binary, ecma source for npm/npmx/corepack, include source files and more
  downloadUrls(args: DownloadArgs) {
    const { installVersion, platform } = args;
    let arch;
    switch (platform.arch) {
      case "x86_64":
        arch = "x64";
        break;
      case "aarch64":
        arch = "arm64";
        break;
      default:
        throw new Error(`unsupported: ${platform}`);
    }
    let os;
    let ext;
    switch (platform.os) {
      case "linux":
        os = "linux";
        ext = "tar.gz";
        break;
      case "darwin":
        os = "darwin";
        ext = "tar.gz";
        break;
      case "windows":
        os = "win";
        ext = "zip";
        break;
      default:
        throw new Error(`unsupported: ${platform}`);
    }
    return [
      `https://nodejs.org/dist/${installVersion}/node-${installVersion}-${os}-${arch}.${ext}`,
    ].map(dwnUrlOut);
  }

  async install(args: InstallArgs) {
    const [{ name: fileName }] = this.downloadUrls(args);
    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);

    await $`${
      depExecShimPath(tar_aa_id, "tar", args.depArts)
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
