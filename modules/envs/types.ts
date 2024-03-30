import { std_path, zod } from "../../deps/common.ts";

const absolutePath = zod.string().refine((path) => std_path.isAbsolute(path));

const provision = zod.object({ ty: zod.string() }).passthrough();

const posixFileProvisionTypes = [
  "posixExec",
  "posixSharedLib",
  "headerFile",
] as const;

// we separate the posix file types in a separate
// array in the interest of type inference
export const wellKnownProvisionTypes = [
  "envVar",
  ...posixFileProvisionTypes,
] as const;

const wellKnownProvision = zod.discriminatedUnion(
  "ty",
  [
    zod.object({
      ty: zod.literal(wellKnownProvisionTypes[0]),
      key: zod.string(),
      val: zod.string(),
    }),
    ...posixFileProvisionTypes.map((ty) =>
      zod.object({ ty: zod.literal(ty), absolutePath })
    ),
  ],
);

const envRecipe = zod.object({
  provides: zod.array(provision),
});

const wellKnownEnvRecipe = envRecipe.merge(zod.object({
  provides: zod.array(wellKnownProvision),
}));

const envsModuleConfig = zod.object({
  envs: zod.record(zod.string(), envRecipe),
});

const validators = {
  provision,
  wellKnownProvision,
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

export type ProvisionReducer<P extends Provision> = (
  provision: P[],
) => Promise<WellKnownProvision[]>;
