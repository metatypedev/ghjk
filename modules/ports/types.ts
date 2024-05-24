//! NOTE: type FooX is a version of Foo after zod processing/transformation

import { semver, zod } from "../../deps/common.ts";
import { relativeFileUrl } from "../../utils/url.ts";
import { ALL_ARCH, ALL_OS, archEnum, osEnum } from "./types/platform.ts";

export { ALL_ARCH, ALL_OS, archEnum, osEnum };

// TODO: find a better identification scheme for ports
export const portName = zod.string().regex(/[^ @]*/);
// FIXME: get rid of semantic minor.patch version from portRef
// to allow install hashes to be equivalent as long as major
// version is the same
// Or alternatively, drop semnatic versioning ports
const portRef = zod.string().regex(/[^ ]*@\d+\.\d+\.\d+/);

const portDep = zod.object({
  name: portName,
});

const portDepFat = portDep.merge(zod.object({
  // FIXME: figure out cyclically putting `installConfigLite` here
  config: zod.unknown(),
}));

const portManifestBase = zod.object({
  ty: zod.string(),
  name: zod.string().min(1),
  platforms: zod.string().array(),
  version: zod.string()
    .refine((str) => semver.parse(str), {
      message: "invalid semver string",
    }),
  // conflictResolution: zod
  //   .enum(["deferToNewer", "override"])
  //   .nullish()
  //   // default value set after transformation
  //   .default("deferToNewer"),
  buildDeps: zod.array(portDep).nullish(),
  resolutionDeps: zod.array(portDep).nullish(),
}).passthrough();

const denoWorkerPortManifest = portManifestBase.merge(
  zod.object({
    ty: zod.literal("denoWorker@v1"),
    moduleSpecifier: zod.string().url().transform(relativeFileUrl),
  }),
);

const ambientAccessPortManifest = portManifestBase.merge(
  zod.object({
    ty: zod.literal("ambientAccess@v1"),
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

const portManifest = zod.discriminatedUnion("ty", [
  denoWorkerPortManifest,
  ambientAccessPortManifest,
]);

const installConfigSimple = zod.object({
  version: zod.string()
    .nullish(),
  // // A place to put captured env vars
  // envVars: zod.record(zod.string(), zod.string()).nullish().default({}),
}).passthrough();

const installConfigBase = installConfigSimple.merge(zod.object({
  buildDepConfigs: zod.record(
    portName,
    // FIXME: figure out cyclically putting `installConfigLite` here
    zod.unknown(),
  ).nullish(),
  resolutionDepConfigs: zod.record(
    portName,
    zod.unknown(),
  ).nullish(),
})).passthrough();

const installConfigBaseFat = installConfigBase.merge(zod.object({
  port: portManifest,
})).passthrough();

const installConfigBaseLite = installConfigBase.merge(zod.object({
  portRef,
})).passthrough();

const stdInstallConfigFat = installConfigBaseFat.merge(zod.object({}))
  .passthrough();
const stdInstallConfigLite = installConfigBaseLite.merge(zod.object({}))
  .passthrough();

const installConfigLite =
  // zod.union([
  stdInstallConfigLite;
// ]);
const installConfigFat = stdInstallConfigFat;

const installConfigResolved = installConfigLite.merge(zod.object({
  // NOTE: version is no longer nullish
  version: zod.string(),
  versionSpecified: zod.boolean().optional(),
  // buildDepConfigs: zod.record(
  //   portName,
  //   // FIXME: figure out cyclically putting `installConfigResolved` here
  //   zod.object({ version: zod.string() }).passthrough(),
  // ),
})).passthrough();

// NOTE: zod unions are tricky. It'll parse with the first schema
// in the array that parses. And if this early schema is a subset
// of its siblings (and it doesn't have `passthrough`), it will discard
// fields meant for sibs.
// Which's to say ordering matters
const installConfig = zod.union([
  // NOTE: generated types break if we make a union of other unions
  // so we get the schemas of those unions instead
  // https://github.com/colinhacks/zod/discussions/3010
  // ...installConfigLite.options,
  // ...installConfigFat.options,
  stdInstallConfigLite,
  stdInstallConfigFat,
]);

const allowedPortDep = zod.object({
  manifest: portManifest,
  defaultInst: installConfigLite,
});

const allowDepSet = zod.record(zod.string(), allowedPortDep);

const allowDepSetHashed = zod.record(zod.string(), zod.string());

const installSetHashed = zod.object({
  installs: zod.array(zod.string()),
  allowedDeps: zod.string(),
});

const installSet = zod.object({
  installs: zod.array(installConfigFat),
  allowedDeps: allowDepSet,
});

const portsModuleConfigHashed = zod.object({
  sets: zod.record(zod.string(), installSetHashed),
});

const portsModuleConfig = zod.object({
  sets: zod.record(zod.string(), installSet),
});

export const installSetProvisionTy = "ghjk.ports.InstallSet";
const installSetProvision = zod.object({
  ty: zod.literal(installSetProvisionTy),
  set: installSet,
});

export const installSetRefProvisionTy = "ghjk.ports.InstallSetRef";
const installSetRefProvision = zod.object({
  ty: zod.literal(installSetRefProvisionTy),
  setId: zod.string(),
});

export const installProvisionTy = "ghjk.ports.Install";
export const installProvision = zod.object({
  ty: zod.literal(installProvisionTy),
  instId: zod.string(),
});

const downloadArtifacts = zod.object({
  installVersion: zod.string(),
  downloadPath: zod.string(),
});

const installArtifacts = zod.object({
  env: zod.record(zod.string(), zod.string()),
  installVersion: zod.string(),
  binPaths: zod.string().array(),
  libPaths: zod.string().array(),
  includePaths: zod.string().array(),
  installPath: zod.string(),
  downloadPath: zod.string(),
});

const validators = {
  osEnum,
  archEnum,
  portName,
  portDep,
  portDepFat,
  portManifestBase,
  denoWorkerPortManifest,
  ambientAccessPortManifest,
  installConfigSimple,
  installConfigBase,
  installConfigBaseFat,
  installConfigBaseLite,
  stdInstallConfigFat,
  stdInstallConfigLite,
  installConfigFat,
  installConfigLite,
  installConfig,
  installConfigResolved,
  portManifest,
  portsModuleConfig,
  portsModuleConfigHashed,
  allowedPortDep,
  allowDepSet,
  allowDepSetHashed,
  installSetProvision,
  installSetRefProvision,
  installProvision,
  installSet,
  installSetHashed,
  string: zod.string(),
  downloadArtifacts,
  installArtifacts,
  stringArray: zod.string().min(1).array(),
};
export default validators;

export type OsEnum = zod.infer<typeof osEnum>;
export type ArchEnum = zod.infer<typeof archEnum>;

export type PortManifestBase = zod.input<typeof validators.portManifestBase>;

export type DenoWorkerPortManifest = zod.input<
  typeof validators.denoWorkerPortManifest
>;

export type AmbientAccessPortManifest = zod.input<
  typeof validators.ambientAccessPortManifest
>;

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
/**
 * This is the transformed version of PortManifest, ready for consumption
 */
export type PortManifestX = zod.infer<
  typeof validators.portManifest
>;

/**
 * PortDeps are used during the port build/install process
 */
export type PortDep = zod.infer<typeof validators.portDep>;
export type PortDepFat = zod.infer<typeof validators.portDepFat>;

export type InstallConfigSimple = zod.input<
  typeof validators.installConfigSimple
>;
export type InstallConfigBaseLite = zod.input<
  typeof validators.installConfigBaseLite
>;
export type InstallConfigBaseFat = zod.input<
  typeof validators.installConfigBaseFat
>;
/**
 * Fat install configs include the port manifest within.
 */
export type InstallConfigFat = zod.input<typeof validators.installConfigFat>;
/**
 * Fat install configs include the port manifest within.
 */
export type InstallConfigFatX = zod.infer<typeof validators.installConfigFat>;
/**
 * Lite install configs refer to the port they use by name.
 */
export type InstallConfigLite = zod.input<typeof validators.installConfigLite>;
/**
 * Lite install configs refer to the port they use by name.
 */
export type InstallConfigLiteX = zod.infer<typeof validators.installConfigLite>;
/**
 * Describes a single installation done by a specific plugin.
 */
export type InstallConfig = zod.input<typeof validators.installConfig>;
/**
 * Describes a single installation done by a specific plugin.
 */
export type InstallConfigX = zod.infer<typeof validators.installConfig>;
/**
 * {@link InstallConfig} after the {@link InstallConfig.version} has been deternimed.
 */
export type InstallConfigResolved = zod.input<
  typeof validators.installConfigResolved
>;
/**
 * {@inheritDoc InstallConfigResolved}
 */
export type InstallConfigResolvedX = zod.infer<
  typeof validators.installConfigResolved
>;

/*
 * Provisions an [`InstallSet`].
 */
export type InstallSetProvision = zod.input<
  typeof validators.installSetProvision
>;
export type InstallSetProvisionX = zod.infer<
  typeof validators.installSetProvision
>;

export type InstallProvision = zod.infer<typeof validators.installProvision>;

/*
 * Provisions an [`InstallSet`] that's been pre-defined in the [`PortsModuleConfigX`].
 */
export type InstallSetRefProvision = zod.input<
  typeof validators.installSetRefProvision
>;
export type InstallSetRefProvisionX = zod.infer<
  typeof validators.installSetRefProvision
>;

export type AllowedPortDep = zod.input<typeof validators.allowedPortDep>;
export type AllowedPortDepX = zod.infer<typeof validators.allowedPortDep>;

export type InstallSet = zod.input<typeof validators.installSet>;
export type InstallSetX = zod.infer<
  typeof validators.installSet
>;

export type InstallSetHashed = zod.input<typeof validators.installSetHashed>;
export type InstallSetHashedX = zod.infer<
  typeof validators.installSetHashed
>;

export type PortsModuleConfig = zod.input<typeof validators.portsModuleConfig>;
export type PortsModuleConfigX = zod.infer<
  typeof validators.portsModuleConfig
>;

export type PortsModuleConfigHashed = zod.input<
  typeof validators.portsModuleConfigHashed
>;
export type PortsModuleConfigLiteHashedX = zod.infer<
  typeof validators.portsModuleConfigHashed
>;

export type DepArt = {
  execs: Record<string, string>;
  libs: Record<string, string>;
  includes: Record<string, string>;
  env: Record<string, string>;
};

export type DepArts = Record<
  string,
  DepArt
>;

export type PlatformInfo = { os: OsEnum; arch: ArchEnum };

export interface PortArgsBase {
  // installType: "version" | "ref";
  installVersion: string;
  installPath: string;
  depArts: DepArts;
  platform: PlatformInfo;
  config: InstallConfigLiteX;
  manifest: PortManifestX;
}

export interface ListAllArgs {
  depArts: DepArts;
  manifest: PortManifestX;
  // FIXME: switch to X type when https://github.com/colinhacks/zod/issues/2864 is resolved
  config: InstallConfigLiteX;
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

export type DownloadArtifacts = zod.infer<typeof validators.downloadArtifacts>;
export type InstallArtifacts = zod.infer<typeof validators.installArtifacts>;
