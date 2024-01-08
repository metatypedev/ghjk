import {
  $,
  defaultLatestStable,
  depExecShimPath,
  type DownloadArgs,
  type InstallArgs,
  type InstallConfigSimple,
  type ListAllArgs,
  osXarch,
  PortBase,
  shimScript,
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
  resolutionDeps: [git_aa_id],
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
      depExecShimPath(git_aa_id, "git", args.depArts)
    } ls-remote ${conf.pluginRepo} HEAD`.lines();

    return fullOut
      .filter(Boolean)
      //NOTE: first 10 char of hashes should be enough
      .map((line) => line.split(/\s/)[0].slice(0, 10));
  }

  latestStable(args: ListAllArgs): Promise<string> {
    return defaultLatestStable(this, args);
  }

  async download(args: DownloadArgs) {
    if (await $.path(args.downloadPath).exists()) {
      // FIXME: remove this once download tracking is part of core
      return;
    }
    const conf = confValidator.parse(args.config);
    await $`${
      depExecShimPath(git_aa_id, "git", args.depArts)
    } clone ${conf.pluginRepo} --depth 1 ${args.tmpDirPath}`;
    await std_fs.copy(
      args.tmpDirPath,
      args.downloadPath,
    );
  }

  async install(args: InstallArgs) {
    const tmpPath = $.path(args.tmpDirPath);
    // we copy the repo to a src dir
    const srcDir = (await tmpPath.ensureDir()).join("src");
    await std_fs.move(
      args.downloadPath,
      srcDir.toString(),
    );
    const installPath = $.path(args.installPath);
    // we create shelShims since some asdf scripts will
    // source/exec some other scripts relatinv on their path
    // which doesn't work with symShims
    const binDir = await tmpPath.join("bin").ensureDir();
    await Promise.all(
      (await Array.fromAsync(srcDir.join("bin").walk({ maxDepth: 1 })))
        .map(async (entry) => {
          if (entry.isDirectory) return;
          await shimScript({
            shimPath: binDir.join(entry.name).toString(),
            // NOTE: we symlink into the installPath, not tmpPath
            execPath: installPath.join("src", "bin", entry.path.basename())
              .toString(),
            os: args.platform.os,
          });
        }),
    );
    if (await installPath.exists()) {
      await installPath.remove({ recursive: true });
    }
    await std_fs.move(tmpPath.toString(), installPath.toString());
  }
}
