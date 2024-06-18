import { $ } from "../../utils/mod.ts";

import type { TaskDefHashedX, TasksModuleConfigX } from "./types.ts";
import type { GhjkCtx } from "../types.ts";
import getLogger from "../../utils/logger.ts";
import { execTaskDeno } from "./deno.ts";

const logger = getLogger(import.meta);

import { cookPosixEnv } from "../envs/posix.ts";
import { getEnvsCtx } from "../envs/inter.ts";

export type TaskGraph = Awaited<ReturnType<typeof buildTaskGraph>>;

export function buildTaskGraph(
  _gcx: GhjkCtx,
  tasksConfig: TasksModuleConfigX,
) {
  const graph = {
    indie: [] as string[],
    // edges from dependency to dependent
    revDepEdges: {} as Record<string, string[]>,
    // edges from dependent to dependency
    depEdges: {} as Record<string, string[] | undefined>,
  };
  for (const [hash, task] of Object.entries(tasksConfig.tasks)) {
    /*
     * FIXME: find a way to pre-check if task envs are availaible
     if (task.envKey && !envsCx.has(task.envKey)) {
      throw new Error(
        `unable to find env referenced by task "${hash}" under key "${task.envKey}"`,
      );
    } */
    if (!task.dependsOn || task.dependsOn.length == 0) {
      graph.indie.push(hash);
    } else {
      for (const depTaskHash of task.dependsOn) {
        const testCycle = (
          name: string,
          depHash: string,
        ): TaskDefHashedX | undefined => {
          const depTask = tasksConfig.tasks[depHash];
          if (!depTask) {
            throw new Error(`specified dependency task doesn't exist`, {
              cause: {
                depHash,
                task,
              },
            });
          }
          const depDeps = depTask.dependsOn ?? [];
          if (depDeps.includes(name)) return depTask;
          for (const depDep of depDeps) {
            const hit = testCycle(name, depDep);
            if (hit) return hit;
          }
        };

        const cycleSource = testCycle(hash, depTaskHash);
        if (
          cycleSource
        ) {
          throw new Error(
            `cyclic dependency detected building task graph`,
            {
              cause: {
                task,
                cycleSource,
              },
            },
          );
        }
        const revDepSet = graph.revDepEdges[depTaskHash];
        if (revDepSet) {
          revDepSet.push(hash);
        } else {
          graph.revDepEdges[depTaskHash] = [hash];
        }
      }
      graph.depEdges[hash] = task.dependsOn;
    }
  }
  return graph;
}

export async function execTask(
  gcx: GhjkCtx,
  tasksConfig: TasksModuleConfigX,
  taskGraph: TaskGraph,
  targetKey: string,
  args: string[],
  // taskEnv: TaskEnvX,
  // installGraph: InstallGraph,
): Promise<void> {
  let workSet = new Set([targetKey]);
  {
    const stack = [targetKey];
    while (stack.length > 0) {
      const taskHash = stack.pop()!;
      const taskDef = tasksConfig.tasks[taskHash];
      stack.push(...taskDef.dependsOn ?? []);
      workSet = new Set([...workSet.keys(), ...taskDef.dependsOn ?? []]);
    }
  }
  const pendingDepEdges = new Map(
    Object.entries(taskGraph.depEdges).map(([key, val]) => [key, val!]),
  );
  const pendingTasks = taskGraph.indie.filter((hash) => workSet.has(hash));
  if (pendingTasks.length == 0) {
    throw new Error("something went wrong, task graph starting set is empty");
  }
  while (pendingTasks.length > 0) {
    const taskKey = pendingTasks.pop()!;
    const taskDef = tasksConfig.tasks[taskKey];

    const taskEnvDir = await Deno.makeTempDir({
      prefix: `ghjkTaskEnv_${taskKey}_`,
    });
    const envsCx = getEnvsCtx(gcx);
    const recipe = envsCx.config.envs[taskDef.envKey];
    const { env: installEnvs } = await cookPosixEnv(
      {
        gcx,
        recipe: recipe ?? { provides: [] },
        envKey: taskDef.envKey ?? `taskEnv_${taskKey}`,
        envDir: taskEnvDir,
      },
    );
    logger.info(
      "executing",
      taskKey,
      args,
    );

    const envVars = {
      ...Deno.env.toObject(),
      ...Object.fromEntries(
        Object.entries(installEnvs).map(
          (
            [key, val],
          ) => {
            if (key.match(/PATH/) && Deno.env.get(key)) {
              val = [...new Set([val, Deno.env.get(key)!.split(":")]).keys()]
                .join(":");
            }
            return [
              key,
              val,
            ];
          },
        ),
      ),
    };
    if (taskDef.ty == "denoFile@v1") {
      if (!gcx.ghjkfilePath) {
        throw new Error(
          "denoFile task found but no ghjkfile. This occurs when ghjk is working just on a lockfile alone",
        );
      }
      const workingDir = gcx.ghjkfilePath.parentOrThrow();
      await execTaskDeno(
        gcx.ghjkfilePath.toFileUrl().toString(),
        {
          key: taskDef.key,
          argv: args,
          envVars,
          workingDir: taskDef.workingDir
            ? workingDir.resolve(taskDef.workingDir).toString()
            : workingDir.toString(),
        },
      );
    } else {
      throw new Error(
        `unsupported task type "${taskDef.ty}"`,
        {
          cause: {
            taskDef,
          },
        },
      );
    }
    $.removeIfExists(taskEnvDir);

    workSet.delete(taskKey);
    const dependentTasks = (taskGraph.revDepEdges[taskKey] ?? [])
      .filter((name) => workSet.has(name));
    const readyTasks = [];
    for (const parentId of dependentTasks) {
      const parentDeps = pendingDepEdges.get(parentId)!;

      // swap remove from parent pending deps list
      const idx = parentDeps.indexOf(taskKey);
      const last = parentDeps.pop()!;
      if (parentDeps.length > idx) {
        parentDeps[idx] = last;
      }

      if (parentDeps.length == 0) {
        // parent is ready for install
        readyTasks.push(parentId);
      }
    }
    pendingTasks.push(...readyTasks);
  }
  if (workSet.size > 0) {
    throw new Error("something went wrong, task graph work set is not empty");
  }
}
