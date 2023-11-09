import { semver, zod } from "../deps/common.ts";

const plugManifestBase = zod.object({
  name: zod.string().min(1),
  version: zod.string()
    .refine((str) => semver.parse(str), {
      message: "not a valid semver",
    })
    .transform(semver.parse),
  conflictResolution: zod
    .enum(["deferToNewer", "override"])
    .nullish()
    .default("deferToNewer"),
}).passthrough();

const denoWorkerPlugManifest = plugManifestBase.merge(
  zod.object({
    moduleSpecifier: zod.string().url(),
  }),
);

export default {
  plugManifestBase,
  denoWorkerPlugManifest,
};
