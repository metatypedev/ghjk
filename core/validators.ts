import { semver, zod } from "../deps/common.ts";

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
    versionExtractFlag: zod.enum(["version", "-v", "--version", "-v"]),
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

export default {
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
