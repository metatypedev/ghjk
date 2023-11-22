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

export default {
  plugDep,
  plugManifestBase,
  denoWorkerPlugManifest,
  ambientAccessPlugManifest,
  string: zod.string(),
  stringArray: zod.string().min(1).array(),
};
