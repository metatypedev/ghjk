import {
  $,
  depExecShimPath,
  DownloadArgs,
  getPortRef,
  InstallArgs,
  InstallConfigFat,
  InstallConfigSimple,
  ListAllArgs,
  ListBinPathsArgs,
  osXarch,
  pathsWithDepArts,
  PortBase,
  tryDepExecShimPath,
  zod,
} from "../port.ts";
import asdf_plugin_git from "./asdf_plugin_git.ts";
import * as std_ports from "../modules/ports/std.ts";

export const manifest = {
  ty: "denoWorker@v1" as const,
  name: "asdf",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [std_ports.curl_aa, std_ports.git_aa, std_ports.asdf_plugin_git],
  // NOTE: we require the same port set for version resolution as well
  resolutionDeps: [
    std_ports.curl_aa,
    std_ports.git_aa,
    std_ports.asdf_plugin_git,
  ],
  platforms: osXarch(["linux", "darwin"], ["x86_64", "aarch64"]),
};

const confValidator = zod.object({
  pluginRepo: zod.string().url(),
  installType: zod
    .enum(["version", "ref"]),
}).passthrough();

export type AsdfInstallConf =
  & InstallConfigSimple
  & zod.input<typeof confValidator>;

export default function conf(
  config: AsdfInstallConf,
): InstallConfigFat {
  // we only need the lite version of the InstConf here
  const { port: pluginPort, ...liteConf } = asdf_plugin_git({
    pluginRepo: config.pluginRepo,
  });
  const depConfigs = {
    [std_ports.asdf_plugin_git.name]: {
      ...liteConf,
      portRef: getPortRef(pluginPort),
    },
  };
  return {
    ...confValidator.parse(config),
    port: manifest,
    depConfigs,
    resolutionDepConfigs: depConfigs,
  };
}

export class Port extends PortBase {
  async listAll(args: ListAllArgs) {
    const out = await $`${
      depExecShimPath(std_ports.asdf_plugin_git, "list-all", args.depArts)
    }`
      .text();
    return out.split(/\s/).filter(Boolean).map((str) => str.trim());
  }

  async latestStable(args: ListAllArgs) {
    const binPath = tryDepExecShimPath(
      std_ports.asdf_plugin_git,
      "latest-stable",
      args.depArts,
    );
    if (!binPath) {
      return super.latestStable(args);
    }
    const conf = confValidator.parse(args.config);
    const out = await $`${binPath}`
      .env({
        PATH: pathsWithDepArts(args.depArts, "linux").PATH,
        ASDF_INSTALL_TYPE: conf.installType,
        // FIXME: asdf requires these vars for latest-stable. this makes no sense!
        ASDF_INSTALL_VERSION: args.config.version ?? "",
        // ASDF_INSTALL_PATH: args.installPath,
      }).text();
    return out.trim();
  }

  async listBinPaths(args: ListBinPathsArgs) {
    const binPath = tryDepExecShimPath(
      std_ports.asdf_plugin_git,
      "list-bin-paths",
      args.depArts,
    );
    if (!binPath) {
      return super.listBinPaths(args);
    }
    const conf = confValidator.parse(args.config);
    const out = await $`${binPath}`
      .env({
        ...pathsWithDepArts(args.depArts, args.platform.os),
        ASDF_INSTALL_TYPE: conf.installType,
        ASDF_INSTALL_VERSION: args.installVersion,
        ASDF_INSTALL_PATH: args.installPath,
      }).text();
    return out.split(/\s/).filter(Boolean).map((str) => str.trim());
  }

  async download(args: DownloadArgs) {
    // some plugins don't have a download script despite the spec
    const binPath = tryDepExecShimPath(
      std_ports.asdf_plugin_git,
      "download",
      args.depArts,
    );
    if (!binPath) {
      return;
    }
    const conf = confValidator.parse(args.config);
    await $`${binPath}`
      .env({
        ...pathsWithDepArts(args.depArts, args.platform.os),
        TMPDIR: args.tmpDirPath,
        ASDF_INSTALL_TYPE: conf.installType,
        ASDF_INSTALL_VERSION: args.installVersion,
        ASDF_INSTALL_PATH: args.installPath,
        ASDF_DOWNLOAD_PATH: args.downloadPath,
      });
  }
  async install(args: InstallArgs) {
    const conf = confValidator.parse(args.config);
    await $`${
      depExecShimPath(std_ports.asdf_plugin_git, "install", args.depArts)
    }`
      .env({
        ...pathsWithDepArts(args.depArts, args.platform.os),
        TMPDIR: args.tmpDirPath,
        ASDF_INSTALL_TYPE: conf.installType,
        ASDF_INSTALL_VERSION: args.installVersion,
        ASDF_INSTALL_PATH: args.installPath,
        ASDF_DOWNLOAD_PATH: args.downloadPath,
        ASDF_CONCURRENCY: args.availConcurrency.toString(),
      });
  }
}
/*
interface ASDF_CONFIG_EXAMPLE {
  ASDF_INSTALL_TYPE: "version" | "ref";
  ASDF_INSTALL_VERSION: string; //	full version number or Git Ref depending on ASDF_INSTALL_TYPE
  ASDF_INSTALL_PATH: string; //	the path to where the tool should, or has been installed
  ASDF_CONCURRENCY: number; //	the number of cores to use when compiling the source code. Useful for setting make -j
  ASDF_DOWNLOAD_PATH: string; //	the path to where the source code or binary was downloaded to by bin/download
  ASDF_PLUGIN_PATH: string; //	the path the plugin was installed
  ASDF_PLUGIN_SOURCE_URL: string; //	the source URL of the plugin
  ASDF_PLUGIN_PREV_REF: string; //	prevous git-ref of the plugin repo
  ASDF_PLUGIN_POST_REF: string; //	updated git-ref of the plugin repo
  ASDF_CMD_FILE: string; // resolves to the full path of the file being sourced
}
*/
