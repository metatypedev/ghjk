import { semver, zod } from "../../deps/common.ts";
import logger from "../../core/logger.ts";
import { std_path } from "../../deps/common.ts";

const plugDep = zod.object({
  id: zod.string(),
});

const plugManifestBase = zod.object({
  name: zod.string().min(1),
  version: zod.string()
    .refine((str) => semver.parse(str), {
      message: "invalid semver string",
    }),
  conflictResolution: zod
    .enum(["deferToNewer", "override"])
    .nullish()
    .default("deferToNewer"),
  deps: zod.array(plugDep).nullish(),
}).passthrough();

const denoWorkerPlugManifest = plugManifestBase.merge(
  zod.object({
    moduleSpecifier: zod.string().url(),
  }),
);

const ambientAccessPlugManifest = plugManifestBase.merge(
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
    plugName: zod.string().min(1),
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
  plugDep,
  plugManifestBase,
  denoWorkerPlugManifest,
  ambientAccessPlugManifest,
  string: zod.string(),
  installConfigBase,
  installConfig,
  asdfInstallConfig,
  stringArray: zod.string().min(1).array(),
};
export default validators;

// Describes the plugin itself
export type PlugManifestBase = zod.input<typeof validators.plugManifestBase>;

export type DenoWorkerPlugManifest = zod.input<
  typeof validators.denoWorkerPlugManifest
>;

export type AmbientAccessPlugManifest = zod.input<
  typeof validators.ambientAccessPlugManifest
>;

// Describes the plugin itself
export type PlugManifest =
  | PlugManifestBase
  | DenoWorkerPlugManifest
  | AmbientAccessPlugManifest;

export type PlugDep = zod.infer<typeof validators.plugDep>;
export type PlugManifestBaseX = zod.infer<typeof validators.plugManifestBase>;
export type DenoWorkerPlugManifestX = zod.infer<
  typeof validators.denoWorkerPlugManifest
>;
export type AmbientAccessPlugManifestX = zod.infer<
  typeof validators.ambientAccessPlugManifest
>;
// This is the transformed version of PlugManifest, ready for consumption
export type PlugManifestX =
  | PlugManifestBaseX
  | DenoWorkerPlugManifestX
  | AmbientAccessPlugManifestX;

export type RegisteredPlug = {
  ty: "ambientAccess";
  manifest: AmbientAccessPlugManifestX;
} | {
  ty: "denoWorker";
  manifest: DenoWorkerPlugManifestX;
} | {
  ty: "asdf";
  manifest: PlugManifestBaseX;
};

export type RegisteredPlugs = Map<string, RegisteredPlug>;

export type InstallConfigBase = zod.input<typeof validators.installConfigBase>;

// Describes a single installation done by a specific plugin.
export type InstallConfig = zod.input<typeof validators.installConfig>;
export type InstallConfigX = zod.infer<typeof validators.installConfig>;
export type AsdfInstallConfig = zod.input<typeof validators.asdfInstallConfig>;
export type AsdfInstallConfigX = zod.infer<typeof validators.asdfInstallConfig>;

export interface GhjkConfig {
  /// Plugs explicitly added by the user
  plugs: RegisteredPlugs;
  installs: InstallConfig[];
}

/// This is a secure sections of the config intended to be direct exports
/// from the config script instead of the global variable approach the
/// main [`GhjkConfig`] can take.
export interface GhjkSecureConfig {
  allowedPluginDeps?: PlugDep[];
}

export type GhjkCtx = GhjkConfig & {
  /// Standard plugs allowed to be use as deps by other plugs
  allowedDeps: RegisteredPlugs;
};

export abstract class PlugBase {
  abstract manifest: PlugManifest;

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
        `using default implementation of latestStable for plug ${this.manifest.name}`,
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

export interface PlugArgsBase {
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

export interface ListBinPathsArgs extends PlugArgsBase {
}

export interface ExecEnvArgs extends PlugArgsBase {
}

export interface DownloadArgs extends PlugArgsBase {
  downloadPath: string;
  tmpDirPath: string;
}

export interface InstallArgs extends PlugArgsBase {
  availConcurrency: number;
  downloadPath: string;
  tmpDirPath: string;
}
