import {
  $,
  depBinShimPath,
  type DownloadArgs,
  type InstallArgs,
  type ListAllArgs,
  osXarch,
  PortBase,
  portsValidators,
  std_fs,
  zod,
} from "../port.ts";

const git_aa_id = {
  id: "git_aa",
};

export const manifest = {
  ty: "denoWorker@v1" as const,
  name: "asdf_git_plugin",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [git_aa_id],
  platforms: osXarch(["linux", "darwin", "windows"], ["aarch64", "x86_64"]),
};

const confValidator = portsValidators.installConfigBase.merge(zod.object({
  pluginRepo: zod.string().url(),
}));

export type AsdfPluginInstallConf = zod.input<typeof confValidator>;

export default function conf(config: AsdfPluginInstallConf) {
  return {
    ...confValidator.parse(config),
    port: manifest,
  };
}

export class Port extends PortBase {
  async listAll(args: ListAllArgs) {
    const fullOut = await $`${
      depBinShimPath(git_aa_id, "git", args.depShims)
    } ls-remote ${args.config.pluginRepo as string} HEAD`.lines();

    return fullOut
      .filter(Boolean)
      //NOTE: first 10 char of hashes should be enough
      .map((line) => line.split(/\s/)[0].slice(0, 10));
  }

  async download(args: DownloadArgs) {
    if (await $.path(args.downloadPath).exists()) {
      return;
    }
    await $`${depBinShimPath(git_aa_id, "git", args.depShims)} clone ${args
      .config.pluginRepo as string} --depth 1 ${args.tmpDirPath}`;
    await std_fs.copy(
      args.tmpDirPath,
      args.downloadPath,
    );
  }

  async install(args: InstallArgs) {
    await std_fs.copy(
      args.downloadPath,
      args.installPath,
    );
  }
}
