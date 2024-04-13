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
  for (const [name, task] of Object.entries(portsConfig.tasks)) {
    if (!portsConfig.envs[task.envHash]) {
      throw new Error(
        `unable to find env referenced by task "${name}" under hash "${task.envHash}"`,
      );
    }
    if (!task.dependsOn || task.dependsOn.length == 0) {
      graph.indie.push(name);
    } else {
      for (const depTaskName of task.dependsOn) {
        const testCycle = (
          name: string,
          depName: string,
        ): TaskDefHashedX | undefined => {
          const depTask = portsConfig.tasks[depName];
          if (!depTask) {
            throw new Error(`specified dependency task doesn't exist`, {
              cause: {
                depTaskName,
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

        const cycleSource = testCycle(name, depTaskName);
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
        graph.revDepEdges[depTaskName] = [
          ...graph.revDepEdges[depTaskName] ?? [],
          name,
        ];
      }
      graph.depEdges[name] = task.dependsOn;
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
  let workSet = new Set([targetName]);
  {
    const stack = [targetName];
    while (stack.length > 0) {
      const taskName = stack.pop()!;
      const taskDef = tasksConfig.tasks[taskName];
      stack.push(...taskDef.dependsOn ?? []);
      workSet = new Set([...workSet.keys(), ...taskDef.dependsOn ?? []]);
    }
  }
  const pendingDepEdges = new Map(
    Object.entries(taskGraph.depEdges).map(([key, val]) => [key, val!]),
  );
  const pendingTasks = taskGraph.indie.filter((name) => workSet.has(name));
  if (pendingTasks.length == 0) {
    throw new Error("something went wrong, task graph starting set is empty");
  }
  while (pendingTasks.length > 0) {
    const taskName = pendingTasks.pop()!;
    const taskDef = tasksConfig.tasks[taskName];

    const taskEnvDir = await Deno.makeTempDir({
      prefix: `ghjkTaskEnv_${taskName}_`,
    });
    const { env: installEnvs } = await cookPosixEnv(
      {
        gcx,
        recipe: tasksConfig.envs[taskDef.envHash],
        envName: `taskEnv_${taskName}`,
        envDir: taskEnvDir,
      },
    );
    logger.info("executing", taskName, args);
    await execTaskDeno(
      std_path.toFileUrl(gcx.ghjkfilePath).href,
      {
        name: taskName,
        argv: args,
        envVars: {
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
        },
        workingDir: std_path.dirname(gcx.ghjkfilePath),
      },
    );
    $.removeIfExists(taskEnvDir);

    workSet.delete(taskName);
    const dependentTasks = (taskGraph.revDepEdges[taskName] ?? [])
      .filter((name) => workSet.has(name));
    const readyTasks = [];
    for (const parentId of dependentTasks) {
      const parentDeps = pendingDepEdges.get(parentId)!;

      // swap remove from parent pending deps list
      const idx = parentDeps.indexOf(taskName);
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
