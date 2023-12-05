import { semver, zod } from "../../deps/common.ts";
import logger from "../../utils/logger.ts";
import { std_path } from "../../deps/common.ts";

// TODO: find a better identification scheme for ports

const portDep = zod.object({
  id: zod.string(),
});

const portManifestBase = zod.object({
  ty: zod.string(),
  name: zod.string().min(1),
  version: zod.string()
    .refine((str) => semver.parse(str), {
      message: "invalid semver string",
    }),
  conflictResolution: zod
    .enum(["deferToNewer", "override"])
    .nullish()
    .default("deferToNewer"),
  deps: zod.array(portDep).nullish(),
}).passthrough();

const denoWorkerPortManifest = portManifestBase.merge(
  zod.object({
    ty: zod.literal("denoWorker"),
    moduleSpecifier: zod.string().url(),
  }),
);

const ambientAccessPortManifest = portManifestBase.merge(
  zod.object({
    ty: zod.literal("ambientAccess"),
    execName: zod.string().min(1),
    versionExtractFlag: zod.enum([
      "version",
      "-v",
      "--version",
      "-V",
      "-W version",
    ]),
    versionExtractRegex: zod.string().refine((str) => new RegExp(str), {
      message: "invalid RegExp string",
    }),
    versionExtractRegexFlags: zod.string().refine(
      (str) => new RegExp("", str),
      {
        message: "invalid RegExp flags",
      },
    ),
    // TODO: custom shell shims
  }),
);
const theAsdfPortManifest = portManifestBase.merge(
  zod.object({
    ty: zod.literal("asdf"),
    moduleSpecifier: zod.string().url(),
  }),
);

const portManifest = zod.discriminatedUnion("ty", [
  denoWorkerPortManifest,
  ambientAccessPortManifest,
  theAsdfPortManifest,
]);

const installConfigBase = zod.object({
  version: zod.string()
    .nullish(),
  conflictResolution: zod
    .enum(["deferToNewer", "override"])
    .nullish()
    .default("deferToNewer"),
  portName: zod.string().min(1),
}).passthrough();

const stdInstallConfig = installConfigBase.merge(zod.object({}));

const asdfInstallConfig = installConfigBase.merge(
  zod.object({
    pluginRepo: zod.string().url(),
    installType: zod
      .enum(["version", "ref"]),
  }),
);

// NOTE: zod unions are tricky. It'll parse with the first schema
// in the array that parses. And if this early schema is a subset
// of its siblings (and it doesn't have `passthrough`), it will discard
// fields meant for sibs.
// Which's to say ordering matters
const installConfig = zod.union([
  asdfInstallConfig,
  stdInstallConfig,
]);

const portsModuleConfigBase = zod.object({
  ports: zod.record(zod.string(), portManifest),
  installs: zod.array(installConfig),
});

const portsModuleSecureConfig = zod.object({
  allowedPortDeps: zod.array(portDep).nullish(),
});

const portsModuleConfig = portsModuleConfigBase.merge(zod.object({
  allowedDeps: zod.record(zod.string(), portManifest),
}));

const validators = {
  portDep,
  portManifestBase,
  denoWorkerPortManifest,
  ambientAccessPortManifest,
  string: zod.string(),
  installConfigBase,
  stdInstallConfig,
  installConfig,
  asdfInstallConfig,
  portManifest,
  portsModuleConfigBase,
  portsModuleSecureConfig,
  portsModuleConfig,
  theAsdfPortManifest,
  stringArray: zod.string().min(1).array(),
};
export default validators;

// Describes the plugin itself
export type PortManifestBase = zod.input<typeof validators.portManifestBase>;

export type DenoWorkerPortManifest = zod.input<
  typeof validators.denoWorkerPortManifest
>;

export type AmbientAccessPortManifest = zod.input<
  typeof validators.ambientAccessPortManifest
>;
export type TheAsdfPortManifest = zod.input<
  typeof validators.theAsdfPortManifest
>;

// Describes the plugin itself
export type PortManifest = zod.input<
  typeof validators.portManifest
>;

export type PortManifestBaseX = zod.infer<typeof validators.portManifestBase>;
export type DenoWorkerPortManifestX = zod.infer<
  typeof validators.denoWorkerPortManifest
>;
export type AmbientAccessPortManifestX = zod.infer<
  typeof validators.ambientAccessPortManifest
>;
// This is the transformed version of PortManifest, ready for consumption
export type PortManifestX = zod.infer<
  typeof validators.portManifest
>;

export type PortDep = zod.infer<typeof validators.portDep>;

export type RegisteredPorts = Record<string, PortManifestX | undefined>;

export type InstallConfigBase = zod.input<
  typeof validators.installConfigBase
>;
export type InstallConfigSimple = Omit<InstallConfigBase, "portName">;

export type AsdfInstallConfig = zod.input<typeof validators.asdfInstallConfig>;
export type AsdfInstallConfigX = zod.infer<typeof validators.asdfInstallConfig>;

// Describes a single installation done by a specific plugin.
// export type InstallConfig = zod.input<typeof validators.installConfig>;
export type InstallConfig = zod.input<typeof validators.installConfig>;
export type InstallConfigX = zod.infer<typeof validators.installConfig>;

export type PortsModuleConfigBase = zod.infer<
  typeof validators.portsModuleConfigBase
>;

/// This is a secure sections of the config intended to be direct exports
/// from the config script instead of the global variable approach the
/// main [`GhjkConfig`] can take.
export type PortsModuleSecureConfig = zod.infer<
  typeof validators.portsModuleSecureConfig
>;

export type PortsModuleConfig = zod.infer<typeof validators.portsModuleConfig>;

export abstract class PortBase {
  abstract manifest: PortManifest;

  execEnv(
    _args: ExecEnvArgs,
  ): Promise<Record<string, string>> | Record<string, string> {
    return {};
  }

  listBinPaths(
    args: ListBinPathsArgs,
  ): Promise<string[]> | string[] {
    return [
      std_path.joinGlobs([std_path.resolve(args.installPath, "bin"), "*"]),
    ];
  }

  listLibPaths(
    args: ListBinPathsArgs,
  ): Promise<string[]> | string[] {
    return [
      std_path.joinGlobs([std_path.resolve(args.installPath, "lib"), "*"]),
    ];
  }

  listIncludePaths(
    args: ListBinPathsArgs,
  ): Promise<string[]> | string[] {
    return [
      std_path.joinGlobs([std_path.resolve(args.installPath, "include"), "*"]),
    ];
  }

  latestStable(args: ListAllArgs): Promise<string> | string {
    return (async () => {
      logger().warning(
        `using default implementation of latestStable for port ${this.manifest.name}`,
      );
      const allVers = await this.listAll(args);
      if (allVers.length == 0) {
        throw new Error("no versions found");
      }
      return allVers[allVers.length - 1];
    })();
  }

  abstract listAll(args: ListAllArgs): Promise<string[]> | string[];

  abstract download(args: DownloadArgs): Promise<void> | void;

  abstract install(args: InstallArgs): Promise<void> | void;
}

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

export type DepShims = Record<
  string,
  Record<string, string>
>;

export type PlatformInfo = Omit<typeof Deno.build, "target">;

export interface PortArgsBase {
  // installType: "version" | "ref";
  installVersion: string;
  installPath: string;
  depShims: DepShims;
  platform: PlatformInfo;
  config: InstallConfigX;
}

export interface ListAllArgs {
  depShims: DepShims;
}

export type ListBinPathsArgs = PortArgsBase;
export type ExecEnvArgs = PortArgsBase;

export interface DownloadArgs extends PortArgsBase {
  downloadPath: string;
  tmpDirPath: string;
}

export interface InstallArgs extends PortArgsBase {
  availConcurrency: number;
  downloadPath: string;
  tmpDirPath: string;
}
