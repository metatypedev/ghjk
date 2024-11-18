import { deep_eql } from "../deps/common.ts";
import {
  DynamicPosixDirProvision,
  PosixDirProvision,
} from "../modules/envs/types.ts";
import getLogger from "../utils/logger.ts";
import { Final } from "./cookbook.ts";

const logger = getLogger(import.meta);

type Var =
  | { kind: "static"; value: string; parentName: string }
  | { kind: "dynamic"; taskId: string; parentName: string };

export interface InstallSet {
  installs: Set<string>;
  allowedBuildDeps: Record<string, string>;
}

export interface MergedEnvs {
  desc: string | undefined;
  name: string | undefined;
  installSet: InstallSet;
  onEnterHookTasks: string[];
  onExitHookTasks: string[];
  vars: Record<string, string>;
  dynVars: Record<string, string>;
  posixDirs: PosixDirProvision[];
  dynamicPosixDirs: DynamicPosixDirProvision[];
}

export class ParentEnvs {
  #childName: string;
  #vars: Map<string, Var> = new Map();
  #posixDirs: Array<PosixDirProvision> = [];
  #dynamicPosixDirs: Array<DynamicPosixDirProvision> = [];
  #installs: Set<string> = new Set();
  #onEnterHooks: string[] = [];
  #onExitHooks: string[] = [];
  #allowedBuildDeps: Map<string, [string, string]> = new Map();

  constructor(childName: string) {
    this.#childName = childName;
  }

  addHooks(onEnterHooks: string[], onExitHooks: string[]) {
    this.#onEnterHooks.push(...onEnterHooks);
    this.#onExitHooks.push(...onExitHooks);
  }

  mergeVars(parentName: string, vars: Record<string, string>) {
    for (const [key, value] of Object.entries(vars)) {
      const conflict = this.#vars.get(key);

      if (
        conflict &&
        !(conflict.kind === "static" && conflict.value === value)
      ) {
        logger.warn(
          "environment variable conflict on multiple env inheritance, parent 2 was chosen",
          {
            child: this.#childName,
            parent1: conflict.parentName,
            parent2: parentName,
            variable: key,
          },
        );
      }

      this.#vars.set(key, { kind: "static", value, parentName });
    }
  }

  mergeDynVars(parentName: string, dynVars: Record<string, string>) {
    for (const [key, taskId] of Object.entries(dynVars)) {
      const conflict = this.#vars.get(key);

      if (
        conflict &&
        !(conflict.kind === "dynamic" && conflict.taskId === taskId)
      ) {
        logger.warn(
          "dynamic environment variable conflict on multiple env inheritance, parent 2 was chosen",
          {
            child: this.#childName,
            parent1: conflict.parentName,
            parent2: parentName,
            variable: key,
          },
        );
      }

      this.#vars.set(key, { kind: "dynamic", taskId, parentName });
    }
  }

  mergePosixDirs(
    posixDirs: Array<PosixDirProvision>,
    dynamicPosixDirs: Array<DynamicPosixDirProvision>,
  ) {
    this.#posixDirs.push(...posixDirs);
    this.#dynamicPosixDirs.push(...dynamicPosixDirs);
  }

  mergeInstalls(
    parentName: string,
    installs: Set<string>,
    allowedBuildDeps: Record<string, string>,
  ) {
    this.#installs = this.#installs.union(installs);

    for (const [key, val] of Object.entries(allowedBuildDeps)) {
      const conflict = this.#allowedBuildDeps.get(key);
      if (conflict && !deep_eql(val, conflict[0])) {
        logger.warn(
          "allowedBuildDeps conflict on multiple env inheritance, parent 2 was chosen",
          {
            child: this.#childName,
            parent1: conflict[1],
            parent2: parentName,
            variable: key,
          },
        );
      }

      this.#allowedBuildDeps.set(key, [val, parentName]);
    }
  }

  withChild(child: Final): MergedEnvs {
    const vars: Record<string, string> = {};
    const dynVars: Record<string, string> = {};

    for (const [key, value] of this.#vars) {
      if (value.kind === "static") {
        vars[key] = value.value;
      } else {
        dynVars[key] = value.taskId;
      }
    }

    return {
      desc: child.desc,
      name: child.name,
      // installSets are not merged here...
      installSet: {
        installs: this.#installs,
        allowedBuildDeps: Object.fromEntries(
          [...this.#allowedBuildDeps.entries()].map(([key, [val]]) => [
            key,
            val,
          ]),
        ),
      },
      onEnterHookTasks: [...this.#onEnterHooks, ...child.onEnterHookTasks],
      onExitHookTasks: [...this.#onExitHooks, ...child.onExitHookTasks],
      vars: { ...vars, ...child.vars },
      dynVars: { ...dynVars, ...child.dynVars },
      posixDirs: [...child.posixDirs, ...this.#posixDirs],
      dynamicPosixDirs: [
        ...child.dynamicPosixDirs,
        ...this.#dynamicPosixDirs,
      ],
    };
  }
}
