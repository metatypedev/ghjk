import {
  $,
  depExecShimPath,
  DownloadArgs,
  InstallArgs,
  InstallConfigFat,
  InstallConfigSimple,
  ListAllArgs,
  ListBinPathsArgs,
  osXarch,
  pathWithDepShims,
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
  // there should only be a single asdf port registered at any time
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
  const { port, ...liteConf } = asdf_plugin_git({
    pluginRepo: config.pluginRepo,
  });
  return {
    ...confValidator.parse(config),
    port: manifest,
    depConfigs: {
      [std_ports.asdf_plugin_git.name]: {
        ...liteConf,
        portName: port.name,
      },
    },
  };
}

export class Port extends PortBase {
  async listAll(args: ListAllArgs) {
    const out = await $`${
      depExecShimPath(std_ports.asdf_plugin_git, "list-all", args.depShims)
    }`
      .text();
    return out.split(/\s/).filter(Boolean).map((str) => str.trim());
  }

  async latestStable(args: ListAllArgs) {
    const binPath = tryDepExecShimPath(
      std_ports.asdf_plugin_git,
      "latest-stable",
      args.depShims,
    );
    if (!binPath) {
      return super.latestStable(args);
    }
    const conf = confValidator.parse(args.config);
    const out = await $`${binPath}`
      .env({
        PATH: pathWithDepShims(args.depShims),
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
      args.depShims,
    );
    if (!binPath) {
      return super.listBinPaths(args);
    }
    const conf = confValidator.parse(args.config);
    const out = await $`${binPath}`
      .env({
        PATH: pathWithDepShims(args.depShims),
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
      args.depShims,
    );
    if (!binPath) {
      return;
    }
    const conf = confValidator.parse(args.config);
    await $`${binPath}`
      .env({
        PATH: pathWithDepShims(args.depShims),
        ASDF_INSTALL_TYPE: conf.installType,
        ASDF_INSTALL_VERSION: args.installVersion,
        ASDF_INSTALL_PATH: args.installPath,
        ASDF_DOWNLOAD_PATH: args.downloadPath,
      });
  }
  async install(args: InstallArgs) {
    const conf = confValidator.parse(args.config);
    await $`${
      depExecShimPath(std_ports.asdf_plugin_git, "install", args.depShims)
    }`
      .env({
        PATH: pathWithDepShims(args.depShims),
        ASDF_INSTALL_TYPE: conf.installType,
        ASDF_INSTALL_VERSION: args.installVersion,
        ASDF_INSTALL_PATH: args.installPath,
        ASDF_DOWNLOAD_PATH: args.downloadPath,
        ASDF_CONCURRENCY: args.availConcurrency.toString(),
      });
  }
}
