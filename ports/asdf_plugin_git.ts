import {
  $,
  AllowedPortDep,
  defaultLatestStable,
  depExecShimPath,
  type DownloadArgs,
  getPortRef,
  type InstallArgs,
  type InstallConfigSimple,
  type ListAllArgs,
  osXarch,
  PortBase,
  shimScript,
  std_fs,
  zod,
} from "../src/deno_ports/mod.ts";
import {
  ghConfValidator,
  type GithubReleasesInstConf,
  readGhVars,
} from "../src/sys_deno/ports/ghrel.ts";

const git_aa_id = {
  name: "git_aa",
};

export const manifest = {
  ty: "denoWorker@v1" as const,
  name: "asdf_plugin_git",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  buildDeps: [git_aa_id],
  resolutionDeps: [git_aa_id],
  platforms: osXarch(["linux", "darwin", "windows"], ["aarch64", "x86_64"]),
};

const confValidator = zod.object({
  pluginRepo: zod.string().url(),
}).passthrough();

export type AsdfPluginInstallConf =
  & InstallConfigSimple
  & GithubReleasesInstConf
  & zod.input<typeof confValidator>;

/**
 * WARNING: this is probably no the function you want if you intend
 * to add `asdf_plugin_git` to your `allowedBuildDeps`.
 *
 * This module exports a {@link buildDep} function for the purpose of adding
 * the port to the allowedBuildDeps list.
 */
export default function conf(config: AsdfPluginInstallConf) {
  return {
    ...readGhVars(),
    ...confValidator.parse(config),
    port: manifest,
  };
}

export function buildDep(): AllowedPortDep {
  return {
    manifest,
    defaultInst: {
      portRef: getPortRef(manifest),
    },
  };
}

export class Port extends PortBase {
  async listAll(args: ListAllArgs) {
    const conf = confValidator.parse(args.config);

    const repoUrl = new URL(conf.pluginRepo);
    if (repoUrl.hostname == "github.com") {
      const ghConf = ghConfValidator.parse(args.config);
      if (ghConf.ghToken) {
        repoUrl.username = ghConf.ghToken;
        repoUrl.password = ghConf.ghToken;
      }
    }

    const fullOut = await $`${
      depExecShimPath(git_aa_id, "git", args.depArts)
    } ls-remote ${repoUrl} HEAD`.lines();

    return fullOut
      .filter(Boolean)
      //NOTE: first 10 char of hashes should be enough
      .map((line) => line.split(/\s/)[0].slice(0, 10));
  }

  override latestStable(args: ListAllArgs): Promise<string> {
    return defaultLatestStable(this, args);
  }

  override async download(args: DownloadArgs) {
    if (await $.path(args.downloadPath).exists()) {
      // FIXME: remove this once download tracking is part of core
      return;
    }
    const conf = confValidator.parse(args.config);
    const repoUrl = new URL(conf.pluginRepo);
    if (repoUrl.hostname == "github.com") {
      const ghConf = ghConfValidator.parse(args.config);
      if (ghConf.ghToken) {
        repoUrl.username = ghConf.ghToken;
        repoUrl.password = ghConf.ghToken;
      }
    }
    await $`${
      depExecShimPath(git_aa_id, "git", args.depArts)
    } clone ${repoUrl} --depth 1 ${args.tmpDirPath}`;
    await std_fs.copy(
      args.tmpDirPath,
      args.downloadPath,
    );
  }

  override async install(args: InstallArgs) {
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
