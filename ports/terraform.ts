import {
  $,
  ALL_OS,
  downloadFile,
  dwnUrlOut,
  osXarch,
  PortBase,
  std_fs,
  std_path,
  unarchive,
} from "../port.ts";
import type {
  DownloadArgs,
  InstallArgs,
  InstallConfigSimple,
} from "../port.ts";

// TODO: sanity check exports of all ports
export const manifest = {
  ty: "denoWorker@v1" as const,
  name: "terraform_hashicorp",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  platforms: osXarch([...ALL_OS], ["aarch64", "x86_64"]),
};

export default function conf(config: InstallConfigSimple = {}) {
  return {
    ...config,
    port: manifest,
  };
}

export class Port extends PortBase {
  async listAll() {
    const rawHtml = await $.request(`https://releases.hashicorp.com/terraform/`)
      .text();
    const versions = [...rawHtml.matchAll(/terraform_([^<\/]*)</g)].map((
      [_, capture],
    ) => capture);

    return versions.reverse();
  }
  async latestStable() {
    const all = await this.listAll();
    // stable versions don't have any additional info in theform of 1.2.3-alpha
    return all.findLast((str) => !str.match(/-/))!;
  }

  // node distribute archives that contain the binary, ecma source for npm/npmx/corepack, include source files and more
  downloadUrls(args: DownloadArgs) {
    const { installVersion, platform } = args;
    let arch;
    switch (platform.arch) {
      case "x86_64":
        arch = "amd64";
        break;
      case "aarch64":
        arch = "arm64";
        break;
      default:
        throw new Error(`unsupported: ${platform}`);
    }
    const os = platform.os;

    return [
      `https://releases.hashicorp.com/terraform/${installVersion}/terraform_${installVersion}_${os}_${arch}.zip`,
    ].map(dwnUrlOut);
  }

  async download(args: DownloadArgs) {
    const urls = this.downloadUrls(args);
    await Promise.all(
      urls.map((obj) => downloadFile({ ...args, ...obj })),
    );
  }

  async install(args: InstallArgs) {
    const [{ name: fileName }] = this.downloadUrls(args);
    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);

    await unarchive(fileDwnPath, args.tmpDirPath);

    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }
    await std_fs.move(
      args.tmpDirPath,
      (await installPath.ensureDir()).join("bin").toString(),
    );
  }
}
