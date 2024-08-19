import { std_path, zod } from "../../deps/common.ts";
import { installProvisionTy } from "../ports/types.ts";
import moduleValidators from "../types.ts";

const absolutePath = zod.string().refine((path) => std_path.isAbsolute(path));

const provision = zod.object({ ty: zod.string() }).passthrough();

const posixFileProvisionTypes = [
  "posix.exec",
  "posix.sharedLib",
  "posix.headerFile",
] as const;

export const posixDirProvisionTypes = [
  "posix.execDir",
  "posix.sharedLibDir",
  "posix.headerDir",
] as const;

export type PosixDirProvisionType = typeof posixDirProvisionTypes[number];

const posixDirProvision = zod.object({
  ty: zod.enum(posixDirProvisionTypes),
  path: absolutePath,
});

export type PosixDirProvision = zod.infer<typeof posixDirProvision>;

const dynamicPathVarProvisionTypes = [
  "posix.execDir.dynamic",
  "posix.sharedLibDir.dynamic",
  "posix.headerDir.dynamic",
] as const;

export const hookProvisionTypes = [
  "hook.onEnter.posixExec",
  "hook.onExit.posixExec",
] as const;

export const installProvisionTypes = [
  installProvisionTy,
] as const;

export const envVarDynTy = "posix.envVarDyn";

// we separate the posix file types in a separate
// array in the interest of type inference
export const wellKnownProvisionTypes = [
  "posix.envVar",
  ...posixDirProvisionTypes,
  ...posixFileProvisionTypes,
  ...hookProvisionTypes,
  ...installProvisionTypes,
] as const;

const wellKnownProvision = zod.discriminatedUnion(
  "ty",
  [
    zod.object({
      ty: zod.literal(wellKnownProvisionTypes[0]),
      key: moduleValidators.envVarName,
      val: zod.string(),
    }),
    ...posixDirProvisionTypes.map((ty) =>
      zod.object({
        ty: zod.literal(ty),
        path: absolutePath,
      })
    ),
    ...hookProvisionTypes.map((ty) =>
      zod.object({
        ty: zod.literal(ty),
        program: zod.string(),
        arguments: zod.string().array(),
      })
    ),
    ...posixFileProvisionTypes.map((ty) =>
      zod.object({ ty: zod.literal(ty), absolutePath })
    ),
    ...installProvisionTypes.map(
      (ty) =>
        zod.object(
          {
            ty: zod.literal(ty),
            instId: zod.string(),
          },
        ),
    ),
  ],
);

const envRecipe = zod.object({
  desc: zod.string().nullish(),
  provides: zod.array(provision),
});

const wellKnownEnvRecipe = envRecipe.merge(zod.object({
  provides: zod.array(wellKnownProvision),
}));

const envsModuleConfig = zod.object({
  defaultEnv: zod.string(),
  envs: zod.record(zod.string(), envRecipe),
  // TODO: regex for env and task names
  envsNamed: zod.record(zod.string(), zod.string()),
}).refine((conf) => conf.envsNamed[conf.defaultEnv], {
  message: `no env found under the provided "defaultEnv"`,
});

const envVarDynProvision = zod.object({
  ty: zod.literal(envVarDynTy),
  key: moduleValidators.envVarName,
  taskKey: zod.string(),
});

const dynamicPathVarProvision = zod.object({
  ty: zod.enum(dynamicPathVarProvisionTypes),
  taskKey: zod.string(),
});
export type DynamicPathVarProvision = zod.infer<typeof dynamicPathVarProvision>;

const validators = {
  provision,
  wellKnownProvision,
  envVarDynProvision,
  posixDirProvision,
  dynamicPathVarProvision,
  envRecipe,
  envsModuleConfig,
  wellKnownEnvRecipe,
};
export default validators;

export type EnvsModuleConfig = zod.input<typeof validators.envsModuleConfig>;
export type EnvsModuleConfigX = zod.infer<typeof validators.envsModuleConfig>;

export type Provision = zod.input<typeof validators.provision>;
export type WellKnownProvision = zod.input<
  typeof validators.wellKnownProvision
>;

export type EnvRecipe = zod.input<typeof validators.envRecipe>;
export type EnvRecipeX = zod.infer<typeof validators.envRecipe>;

export type WellKnownEnvRecipe = zod.input<
  typeof validators.wellKnownEnvRecipe
>;
export type WellKnownEnvRecipeX = zod.infer<
  typeof validators.wellKnownEnvRecipe
>;

/*
 * A function that batch convert strange provisions of a certain kind to well known ones.
 */
export type ProvisionReducer<P extends Provision, O extends Provision> = (
  provisions: P[],
) => Promise<O[]>;
