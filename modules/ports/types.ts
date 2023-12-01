import { semver, zod } from "../../deps/common.ts";
import logger from "../../utils/logger.ts";
import { std_path } from "../../deps/common.ts";

// TODO: find a better identification scheme for ports

const portDep = zod.object({
  id: zod.string(),
});

const portManifestBase = zod.object({
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
    moduleSpecifier: zod.string().url(),
  }),
);

const ambientAccessPortManifest = portManifestBase.merge(
  zod.object({
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

const installConfigBase = zod.object({
  version: zod.string()
    .nullish(),
  conflictResolution: zod
    .enum(["deferToNewer", "override"])
    .nullish()
    .default("deferToNewer"),
}).passthrough();

const installConfig = installConfigBase.merge(
  zod.object({
    portName: zod.string().min(1),
  }),
);

const asdfInstallConfig = installConfig.merge(
  zod.object({
    plugRepo: zod.string().url(),
    installType: zod
      .enum(["version", "ref"]),
  }),
);

const validators = {
  portDep,
  portManifestBase,
  denoWorkerPortManifest,
  ambientAccessPortManifest,
  string: zod.string(),
  installConfigBase,
  installConfig,
  asdfInstallConfig,
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

// Describes the plugin itself
export type PortManifest =
  | PortManifestBase
  | DenoWorkerPortManifest
  | AmbientAccessPortManifest;

export type PortDep = zod.infer<typeof validators.portDep>;
export type PortManifestBaseX = zod.infer<typeof validators.portManifestBase>;
export type DenoWorkerPortManifestX = zod.infer<
  typeof validators.denoWorkerPortManifest
>;
export type AmbientAccessPortManifestX = zod.infer<
  typeof validators.ambientAccessPortManifest
>;
// This is the transformed version of PortManifest, ready for consumption
export type PortManifestX =
  | PortManifestBaseX
  | DenoWorkerPortManifestX
  | AmbientAccessPortManifestX;

export type RegisteredPort = {
  ty: "ambientAccess";
  manifest: AmbientAccessPortManifestX;
} | {
  ty: "denoWorker";
  manifest: DenoWorkerPortManifestX;
} | {
  ty: "asdf";
  manifest: PortManifestBaseX;
};

export type RegisteredPorts = Map<string, RegisteredPort>;

export type InstallConfigBase = zod.input<typeof validators.installConfigBase>;

// Describes a single installation done by a specific plugin.
export type InstallConfig = zod.input<typeof validators.installConfig>;
export type InstallConfigX = zod.infer<typeof validators.installConfig>;
export type AsdfInstallConfig = zod.input<typeof validators.asdfInstallConfig>;
export type AsdfInstallConfigX = zod.infer<typeof validators.asdfInstallConfig>;

export interface GhjkConfig {
  /// Ports explicitly added by the user
  ports: RegisteredPorts;
  installs: InstallConfig[];
}

/// This is a secure sections of the config intended to be direct exports
/// from the config script instead of the global variable approach the
/// main [`GhjkConfig`] can take.
export interface GhjkSecureConfig {
  allowedPortDeps?: PortDep[];
}

export type GhjkCtx = GhjkConfig & {
  /// Standard list of ports allowed to be use as deps by other ports
  allowedDeps: RegisteredPorts;
};

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

export interface ListBinPathsArgs extends PortArgsBase {
}

export interface ExecEnvArgs extends PortArgsBase {
}

export interface DownloadArgs extends PortArgsBase {
  downloadPath: string;
  tmpDirPath: string;
}

export interface InstallArgs extends PortArgsBase {
  availConcurrency: number;
  downloadPath: string;
  tmpDirPath: string;
}
