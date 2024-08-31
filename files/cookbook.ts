import {
  EnvFinalizer,
  FinalizedEnv,
  InlineTaskHookProvision,
  objectHashSafe,
  TaskDefTyped,
} from "./mod.ts";
import {
  EnvRecipe,
  EnvsModuleConfig,
  WellKnownProvision,
} from "../modules/envs/types.ts";
import { InstallSetRefProvision, unwrapZodRes } from "../port.ts";
import { InstallSet, MergedEnvs } from "./merged_envs.ts";
import envsValidators from "../modules/envs/types.ts";
import getLogger from "../utils/logger.ts";

export type Final = ReturnType<EnvFinalizer> & {
  envBaseResolved: null | string[];
};

const logger = getLogger(import.meta);

interface MergedEntries {
  vars: Record<string, string>;
  dynVars: Record<string, string>;
}

export class Cookbook {
  #moduleConfig: EnvsModuleConfig;

  constructor(
    public installSets: Map<string, InstallSet>,
    public finalizedEnvs: Record<string, FinalizedEnv>,
    public tasks: Map<string, TaskDefTyped>,
    defaultEnv: string,
  ) {
    this.#moduleConfig = {
      envs: {},
      defaultEnv,
      envsNamed: {},
    };
  }

  public registerEnv(final: Final, merged: MergedEnvs) {
    const recipe = new RecipeBuilder(this, merged).build();

    const installSetId = this.#getInstallSetId(final, merged.installSet);
    if (installSetId) {
      const prov: InstallSetRefProvision = {
        ty: "ghjk.ports.InstallSetRef",
        setId: installSetId,
      };
      recipe.provides.push(prov);
    }

    const hash = objectHashSafe(recipe);
    this.finalizedEnvs[final.key] = {
      installSetId,
      finalized: final,
      merged,
      envHash: hash,
    };

    logger.debug("registering env", { key: final.key, name: final.name, hash });
    this.#moduleConfig.envs[hash] = recipe;
    if (final.name) {
      this.#moduleConfig.envsNamed[final.name] = hash;
    }
  }

  get moduleConfig() {
    return this.#moduleConfig;
  }

  #getInstallSetId(final: Final, baseSet: InstallSet): string | undefined {
    const installSet = this.installSets.get(final.installSetId);
    if (installSet) {
      installSet.installs = installSet.installs.union(
        baseSet.installs,
      );
      for (
        const [key, val] of Object.entries(
          baseSet.allowedBuildDeps,
        )
      ) {
        // prefer the port dep config of the child over any
        // similar deps in the base
        if (!installSet.allowedBuildDeps[key]) {
          installSet.allowedBuildDeps[key] = val;
        }
      }
      return final.installSetId;
    } // if there's no install set found under the id
    else {
      // implies that the env has not ports explicitly configured
      if (final.envBaseResolved) {
        // has a singluar parent
        if (final.envBaseResolved.length == 1) {
          return this.finalizedEnvs[final.envBaseResolved[0]]
            .installSetId;
        } else {
          this.installSets.set(
            final.installSetId,
            baseSet,
          );
          return final.installSetId;
        }
      }
    }
  }
}

class RecipeBuilder {
  constructor(
    private book: Cookbook,
    private compactEnv: MergedEnvs,
  ) {}

  build(): EnvRecipe {
    return {
      desc: this.compactEnv.desc,
      provides: [
        ...Object.entries(this.compactEnv.vars).map(([key, val]) => {
          const prov: WellKnownProvision = { ty: "posix.envVar", key, val };
          return prov;
        }),
        ...Object.entries(this.compactEnv.dynVars).map(([key, val]) => {
          const prov = { ty: "posix.envVarDyn", key, taskKey: val };
          return unwrapZodRes(
            envsValidators.envVarDynProvision.safeParse(prov),
            prov,
          );
        }),
        ...this.compactEnv.posixDirs,
        ...this.compactEnv.dynamicPosixDirs,
        // env hooks
        ...this.#getHooks(),
      ],
    };
  }

  #getHooks(): InlineTaskHookProvision[] {
    return [
      ...this.compactEnv.onEnterHookTasks.map(
        (key) => [key, "hook.onEnter.ghjkTask"] as const,
      ),
      ...this.compactEnv.onExitHookTasks.map(
        (key) => [key, "hook.onExit.ghjkTask"] as const,
      ),
    ].map(([taskKey, ty]) => {
      const task = this.book.tasks.get(taskKey);
      if (!task) {
        throw new Error("unable to find task for onEnterHook", {
          cause: {
            env: this.compactEnv.name,
            taskKey,
          },
        });
      }
      if (task.ty == "denoFile@v1") {
        const prov: InlineTaskHookProvision = {
          ty,
          taskKey,
        };
        return prov;
      }
      throw new Error(
        `unsupported task type "${task.ty}" used for environment hook`,
        {
          cause: {
            taskKey,
            task,
          },
        },
      );
    });
  }
}
