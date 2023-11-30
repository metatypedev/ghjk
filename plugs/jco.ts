import {
  addInstallGlobal,
  depBinShimPath,
  DownloadArgs,
  downloadFile,
  InstallArgs,
  type InstallConfigBase,
  ListAllArgs,
  pathWithDepShims,
  type PlatformInfo,
  PlugBase,
  registerDenoPlugGlobal,
  removeFile,
  spawn,
  std_fs,
  std_path,
  std_url,
  unarchive,
} from "../plug.ts";
import node from "./node.ts";
import * as std_plugs from "../std.ts";

const manifest = {
  name: "jco@npm",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [
    std_plugs.node_org,
  ],
};
registerDenoPlugGlobal(manifest, () => new Plug());

export default function install({ version }: InstallConfigBase = {}) {
  addInstallGlobal({
    plugName: manifest.name,
    version,
  });
  // FIXME: conflict flags for install configs
  node({});
}

class Plug extends PlugBase {
  manifest = manifest;

  async listAll(_env: ListAllArgs) {
    const metadataRequest = await fetch(
      `https://registry.npmjs.org/@bytecodealliance/jco`,
      {
        headers: {
          // use abbreviated registry info which's still 500kb unzipped
          "Accept": "application/vnd.npm.install-v1+json",
        },
      },
    );
    const metadata = await metadataRequest.json() as {
      versions: Record<string, unknown>;
    };

    const versions = Object.keys(metadata.versions);
    return versions;
  }

  async download(args: DownloadArgs) {
    await downloadFile(
      args,
      artifactUrl(args.installVersion, args.platform),
    );
  }

  async install(args: InstallArgs) {
    const fileName = std_url.basename(
      artifactUrl(args.installVersion, args.platform),
    );
    const fileDwnPath = std_path.resolve(args.downloadPath, fileName);

    await unarchive(fileDwnPath, args.tmpDirPath);

    if (await std_fs.exists(args.installPath)) {
      await removeFile(args.installPath, { recursive: true });
    }

    await std_fs.copy(
      std_path.resolve(
        args.tmpDirPath,
        "package",
      ),
      args.installPath,
    );
    await spawn([
      depBinShimPath(std_plugs.node_org, "npm", args.depShims),
      "install",
      "--no-fund",
    ], {
      cwd: args.installPath,
      env: {
        PATH: pathWithDepShims(args.depShims),
      },
    });
    await std_fs.ensureDir(std_path.resolve(args.installPath, "bin"));
    await Deno.symlink(
      std_path.resolve(args.installPath, "src", "jco.js"),
      std_path.resolve(args.installPath, "bin", "jco"),
    );
  }
}

function artifactUrl(installVersion: string, _platform: PlatformInfo) {
  return `https://registry.npmjs.org/@bytecodealliance/jco/-/jco-${installVersion}.tgz`;
}
