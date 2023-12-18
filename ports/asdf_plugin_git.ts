import {
  $,
  depExecShimPath,
  type DownloadArgs,
  type InstallArgs,
  type InstallConfigSimple,
  type ListAllArgs,
  osXarch,
  PortBase,
  std_fs,
  zod,
} from "../port.ts";

const git_aa_id = {
  name: "git_aa",
};

export const manifest = {
  ty: "denoWorker@v1" as const,
  name: "asdf_plugin_git",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [git_aa_id],
  platforms: osXarch(["linux", "darwin", "windows"], ["aarch64", "x86_64"]),
};

const confValidator = zod.object({
  pluginRepo: zod.string().url(),
}).passthrough();

export type AsdfPluginInstallConf =
  & InstallConfigSimple
  & zod.input<typeof confValidator>;

export default function conf(config: AsdfPluginInstallConf) {
  return {
    ...confValidator.parse(config),
    port: manifest,
  };
}

export class Port extends PortBase {
  async listAll(args: ListAllArgs) {
    const conf = confValidator.parse(args.config);
    const fullOut = await $`${
      depExecShimPath(git_aa_id, "git", args.depShims)
    } ls-remote ${conf.pluginRepo} HEAD`.lines();

    return fullOut
      .filter(Boolean)
      //NOTE: first 10 char of hashes should be enough
      .map((line) => line.split(/\s/)[0].slice(0, 10));
  }

  async download(args: DownloadArgs) {
    if (await $.path(args.downloadPath).exists()) {
      return;
    }
    const conf = confValidator.parse(args.config);
    await $`${
      depExecShimPath(git_aa_id, "git", args.depShims)
    } clone ${conf.pluginRepo} --depth 1 ${args.tmpDirPath}`;
    await std_fs.copy(
      args.tmpDirPath,
      args.downloadPath,
    );
  }

  async install(args: InstallArgs) {
    const installPath = $.path(args.installPath);
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }
    // we copy the repo to a src dir
    const srcDir = installPath.join("src");
    await std_fs.move(
      args.downloadPath,
      srcDir.toString(),
    );
    // we create shelShims since some asdf scripts will
    // source/exec some other scripts relatinv on their path
    // which doesn't work with symShims
    const binDir = await installPath.join("bin").ensureDir();
    await Promise.all(
      (await Array.fromAsync(srcDir.join("bin").walk({ maxDepth: 1 })))
        .map(async (entry) => {
          if (entry.isFile) {
            // use exec to ensure the scripts executes in it's own shell
            await binDir.join(entry.name).writeText(
              `#!/usr/bin/env sh
exec ${entry.path.toString()}`,
              { mode: 0o700 },
            );
          }
        }),
    );
  }
}
