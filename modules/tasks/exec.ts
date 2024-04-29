import { std_path } from "../../deps/cli.ts";
import { $, DePromisify } from "../../utils/mod.ts";

import type { TaskDefHashedX, TasksModuleConfigX } from "./types.ts";
import type { GhjkCtx } from "../types.ts";
import getLogger from "../../utils/logger.ts";
import { execTaskDeno } from "./deno.ts";

const logger = getLogger(import.meta);

import { cookPosixEnv } from "../envs/posix.ts";

export type TaskGraph = DePromisify<ReturnType<typeof buildTaskGraph>>;

export function buildTaskGraph(
  _gcx: GhjkCtx,
  portsConfig: TasksModuleConfigX,
  // env: Blackboard,
) {
  const graph = {
    indie: [] as string[],
    // edges from dependency to dependent
    revDepEdges: {} as Record<string, string[]>,
    // edges from dependent to dependency
    depEdges: {} as Record<string, string[] | undefined>,
  };
  for (const [hash, task] of Object.entries(portsConfig.tasks)) {
    if (!portsConfig.envs[task.envHash]) {
      throw new Error(
        `unable to find env referenced by task "${hash}" under hash "${task.envHash}"`,
      );
    }
    if (!task.dependsOn || task.dependsOn.length == 0) {
      graph.indie.push(hash);
    } else {
      for (const depTaskHash of task.dependsOn) {
        const testCycle = (
          name: string,
          depHash: string,
        ): TaskDefHashedX | undefined => {
          const depTask = portsConfig.tasks[depHash];
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
  targetName: string,
  args: string[],
  // taskEnv: TaskEnvX,
  // installGraph: InstallGraph,
): Promise<void> {
  const targetHash = tasksConfig.tasksNamed[targetName];
  let workSet = new Set([targetHash]);
  {
    const stack = [targetHash];
    while (stack.length > 0) {
      const taskHash = stack.pop()!;
      const taskDef = tasksConfig.tasks[taskHash];
      stack.push(...taskDef.dependsOn ?? []);
      workSet = new Set([...workSet.keys(), ...taskDef.dependsOn ?? []]);
    }
  }
  const hashToName = Object.fromEntries(
    Object.entries(tasksConfig.tasksNamed).map(([name, hash]) => [hash, name]),
  );
  const pendingDepEdges = new Map(
    Object.entries(taskGraph.depEdges).map(([key, val]) => [key, val!]),
  );
  const pendingTasks = taskGraph.indie.filter((hash) => workSet.has(hash));
  if (pendingTasks.length == 0) {
    throw new Error("something went wrong, task graph starting set is empty");
  }
  while (pendingTasks.length > 0) {
    const taskHash = pendingTasks.pop()!;
    const taskDef = tasksConfig.tasks[taskHash];

    const taskEnvDir = await Deno.makeTempDir({
      prefix: `ghjkTaskEnv_${taskHash}_`,
    });
    const { env: installEnvs } = await cookPosixEnv(
      {
        gcx,
        recipe: tasksConfig.envs[taskDef.envHash],
        envName: `taskEnv_${taskHash}`,
        envDir: taskEnvDir,
      },
    );
    logger.info(
      "executing",
      hashToName[taskHash] ?? taskDef.key ?? taskHash,
      args,
    );

    const envVars = {
      ...Deno.env.toObject(),
      ...Object.fromEntries(
        Object.entries(installEnvs).map(
          (
            [key, val],
          ) => [
            key,
            key.match(/PATH/i) ? `${val}:${Deno.env.get(key) ?? ""}` : val,
          ],
        ),
      ),
    };
    if (taskDef.ty == "denoWorker@v1") {
      await execTaskDeno(
        taskDef.moduleSpecifier,
        {
          key: taskDef.key,
          argv: args,
          envVars,
          workingDir: std_path.dirname(gcx.ghjkfilePath),
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

    workSet.delete(taskHash);
    const dependentTasks = (taskGraph.revDepEdges[taskHash] ?? [])
      .filter((name) => workSet.has(name));
    const readyTasks = [];
    for (const parentId of dependentTasks) {
      const parentDeps = pendingDepEdges.get(parentId)!;

      // swap remove from parent pending deps list
      const idx = parentDeps.indexOf(taskHash);
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
