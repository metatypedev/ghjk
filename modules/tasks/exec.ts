import { std_path } from "../../deps/cli.ts";
import { $, DePromisify } from "../../utils/mod.ts";

import type { TasksModuleConfigX } from "./types.ts";
import type { GhjkCtx } from "../types.ts";
import logger from "../../utils/logger.ts";
import { execTaskDeno } from "./deno.ts";

import {
  buildInstallGraph,
  installFromGraphAndShimEnv,
  syncCtxFromGhjk,
} from "../ports/sync.ts";
import type { InstallConfigResolvedX } from "../ports/types.ts";

export type ExecCtx = DePromisify<ReturnType<typeof execCtxFromGhjk>>;

export async function execCtxFromGhjk(
  gcx: GhjkCtx,
  memoPreload: Record<string, InstallConfigResolvedX> = {},
) {
  const syncCx = await syncCtxFromGhjk(gcx, memoPreload);
  return {
    ghjkCx: gcx,
    syncCx,
    async [Symbol.asyncDispose]() {
      await syncCx![Symbol.asyncDispose]();
    },
  };
}

export type TaskGraph = DePromisify<ReturnType<typeof buildTaskGraph>>;

export async function buildTaskGraph(
  ecx: ExecCtx,
  portsConfig: TasksModuleConfigX,
) {
  const graph = {
    indie: [] as string[],
    // edges from dependency to dependent
    revDepEdges: {} as Record<string, string[]>,
    // edges from dependent to dependency
    depEdges: {} as Record<string, string[] | undefined>,
    // the install graphs for the ports declared by the tasks
    portInstallGraphs: Object.fromEntries(
      await Promise.all(
        Object.entries(portsConfig.tasks)
          .map(async ([name, task]) => [
            name,
            await buildInstallGraph(
              ecx.syncCx,
              {
                installs: task.env.installs,
                allowedDeps: task.env.allowedPortDeps,
              },
            ),
          ]),
      ),
    ),
  };
  for (const [name, task] of Object.entries(portsConfig.tasks)) {
    if (!task.dependsOn) {
      graph.indie.push(name);
    } else {
      for (const depTaskName of task.dependsOn) {
        const depTask = portsConfig.tasks[name];
        if (!depTask) {
          throw new Error(`specified dependency task doesn't exist`, {
            cause: task,
          });
        }
        const depTaskDeps = graph.depEdges[depTaskName];
        if (depTaskDeps?.includes(name)) {
          throw new Error(
            `cycling dependency detected between tasks ${name} & ${depTaskName}`,
            {
              cause: {
                task,
                depTask,
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
  ecx: ExecCtx,
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
    const taskEnv = tasksConfig.tasks[taskName];

    const installGraph = taskGraph.portInstallGraphs[taskName];
    const taskEnvDir = await Deno.makeTempDir({
      prefix: `ghjkTaskEnv_${taskName}_`,
    });
    const { env: installEnvs } = await installFromGraphAndShimEnv(
      ecx.syncCx,
      taskEnvDir,
      installGraph,
    );
    logger().info("executing", taskName);
    await execTaskDeno(
      std_path.toFileUrl(ecx.ghjkCx.configPath).href,
      taskName,
      args,
      {
        ...installEnvs,
        ...taskEnv.env.env,
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
