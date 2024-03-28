import { std_path, zod } from "../../deps/common.ts";

const absolutePath = zod.string().refine((path) => std_path.isAbsolute(path));

const envVars = zod.record(zod.string(), zod.string());

const provision = zod.object({ ty: zod.string() }).passthrough();

export const wellKnownProvisionTypes = [
  "posixExec",
  "posixSharedLib",
  "headerFile",
] as const;

const wellKnownProvision = zod.discriminatedUnion(
  "ty",
  [
    // the types require that the discrim union array is not
    // empty so we move the first item out of the `map` statement
    // to appease typescript
    zod.object({ ty: zod.literal(wellKnownProvisionTypes[0]), absolutePath }),
    ...wellKnownProvisionTypes.slice(1).map((ty) =>
      zod.object({ ty: zod.literal(ty), absolutePath })
    ),
  ],
);

const envRecipe = zod.object({
  vars: envVars,
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

export type ProvisionReducer = (
  provision: Provision,
) => Promise<Array<WellKnownProvision>>;
