import {
  $,
  ALL_ARCH,
  defaultLatestStable,
  depExecShimPath,
  downloadFile,
  dwnUrlOut,
  osXarch,
  PortBase,
  std_fs,
} from "../src/deno_ports/mod.ts";
import type {
  DownloadArgs,
  InstallArgs,
  InstallConfigSimple,
  ListAllArgs,
} from "../src/deno_ports/mod.ts";

const git_aa_id = {
  name: "git_aa",
};

// TODO: sanity check exports of all ports
export const manifest = {
  ty: "denoWorker@v1" as const,
  name: "rustup_rustlang",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  buildDeps: [git_aa_id],
  resolutionDeps: [git_aa_id],
  platforms: [
    ...osXarch(["darwin", "linux"], [...ALL_ARCH]),
    ...osXarch(["windows", "illumos", "freebsd", "netbsd"], ["x86_64"]),
  ],
};

export default function conf(config: InstallConfigSimple = {}) {
  return {
    ...config,
    port: manifest,
  };
}

export class Port extends PortBase {
  repoOwner = "rust-lang";
  repoName = "rustup";

  async listAll(args: ListAllArgs) {
    // FIXME: better way of listing avail versions without
    // depending on git
    const fullOut = await $`${
      depExecShimPath(git_aa_id, "git", args.depArts)
    } ls-remote https://github.com/${this.repoOwner}/${this.repoName}`
      .text();
    const versions = [...fullOut.matchAll(/tags\/([^\^\/\n]*)/g)].map((
      [_, capture],
    ) => capture);

    return [...new Set(versions).keys()]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  override latestStable(args: ListAllArgs): Promise<string> {
    return defaultLatestStable(this, args);
  }

  // https://rust-lang.github.io/rustup/installation/other.html
  downloadUrls(args: DownloadArgs) {
    const { installVersion, platform } = args;
    const arch = platform.arch;
    let os;
    let ext = "";
    switch (platform.os) {
      case "linux":
        os = "unknown-linux-gnu";
        break;
      case "darwin":
        os = "apple-darwin";
        break;
      case "windows":
        os = "pc-windows-gnu";
        ext = ".exe";
        break;
      case "illumos":
        os = "unknown-illumos";
        break;
      case "freebsd":
        os = "unknown-freebsd";
        break;
      case "netbsd":
        os = "unknown-netbsd";
        break;
      default:
        throw new Error(`unsupported: ${platform}`);
    }

    return [
      `https://static.rust-lang.org/rustup/archive/${installVersion}/${arch}-${os}/rustup-init${ext}`,
    ].map(dwnUrlOut);
  }

  override async download(args: DownloadArgs) {
    const urls = this.downloadUrls(args);
    await Promise.all(
      urls.map((obj) => downloadFile({ ...args, ...obj, mode: 0o700 })),
    );
  }

  override async install(args: InstallArgs) {
    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }
    await std_fs.copy(
      args.downloadPath,
      (await installPath.ensureDir()).join("bin").toString(),
    );
  }
}
