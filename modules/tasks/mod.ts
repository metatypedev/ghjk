export * from "./types.ts";

import { cliffy_cmd, std_path } from "../../deps/cli.ts";
import { $, JSONValue } from "../../utils/mod.ts";

import validators from "./types.ts";
import type { TaskDefX, TasksModuleConfigX } from "./types.ts";
import type { GhjkCtx, ModuleManifest } from "../types.ts";
import { ModuleBase } from "../mod.ts";
import logger from "../../utils/logger.ts";
import { execTaskDeno } from "./deno.ts";

import {
  buildInstallGraph,
  installFromGraphAndShimEnv,
  InstallGraph,
  syncCtxFromGhjk,
} from "../ports/sync.ts";

export type TaskModuleManifest = {
  config: TasksModuleConfigX;
  // taskGraph: TaskGraph;
  portInstallGraphs: Record<string, InstallGraph>;
};

type TasksCtx = TaskModuleManifest;

export class TasksModule extends ModuleBase<TaskModuleManifest> {
  async processManifest(
    ctx: GhjkCtx,
    manifest: ModuleManifest,
  ) {
    const res = validators.tasksModuleConfig.safeParse(manifest.config);
    if (!res.success) {
      throw new Error("error parsing ports module config", {
        cause: {
          config: manifest.config,
          zodErr: res.error,
        },
      });
    }
    // const taskGraph = buildTaskGraph(res.data);
    await using syncCx = await syncCtxFromGhjk(ctx);
    const portInstallGraphs = Object.fromEntries(
      await Promise.all(
        Object.entries(res.data.tasks)
          .map(async ([name, task]) => [
            name,
            await buildInstallGraph(
              syncCx,
              {
                installs: task.env.installs,
                allowedDeps: task.env.allowedPortDeps,
              },
            ),
          ]),
      ),
    );
    return {
      config: res.data,
      // taskGraph,
      portInstallGraphs,
    };
  }

  command(
    ghjkCtx: GhjkCtx,
    manifest: TaskModuleManifest,
  ) {
    const cx = manifest;
    const commands = Object.entries(manifest.config.tasks).map(
      ([name, task]) => {
        let cliffyCmd = new cliffy_cmd.Command()
          .name(name)
          .useRawArgs()
          .action(async (_, ...args) => {
            await execTask(
              ghjkCtx,
              cx,
              name,
              args,
            );
          });
        if (task.desc) {
          cliffyCmd = cliffyCmd.description(task.desc);
        }

        return cliffyCmd;
      },
    );
    let root: cliffy_cmd.Command<any, any, any, any> = new cliffy_cmd.Command()
      .alias("x")
      .action(function () {
        this.showHelp();
      })
      .description("Tasks module.");
    for (const cmd of commands) {
      root = root.command(cmd.getName(), cmd);
    }
    return root;
  }

  loadLockEntry(
    _ctx: GhjkCtx,
    raw: JSONValue,
  ) {
    if (!raw || typeof raw != "object" || Array.isArray(raw)) {
      throw new Error(`unexepected value deserializing lockEntry`);
    }
    const { version, ...rest } = raw;
    if (version != "0") {
      throw new Error(`unexepected version tag deserializing lockEntry`);
    }
    // FIXME: zod this up
    return rest as TaskModuleManifest;
  }

  genLockEntry(
    _ctx: GhjkCtx,
    manifest: TaskModuleManifest,
  ) {
    return {
      version: "0",
      ...JSON.parse(JSON.stringify(manifest)),
    };
  }
}

export type TaskGraph = ReturnType<typeof buildTaskGraph>;

export function buildTaskGraph(
  tasks: Record<string, TaskDefX>,
) {
  const graph = {
    indie: [] as string[],
    // edges from dependency to dependent
    revDepEdges: {} as Record<string, string[]>,
    // edges from dependent to dependency
    depEdges: {} as Record<string, string[] | undefined>,
  };
  for (const [name, task] of Object.entries(tasks)) {
    if (!task.dependsOn) {
      graph.indie.push(name);
    } else {
      for (const depTaskName of task.dependsOn) {
        const depTask = tasks[name];
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
  ctx: GhjkCtx,
  cx: TasksCtx,
  targetName: string,
  args: string[],
  // taskEnv: TaskEnvX,
  // installGraph: InstallGraph,
): Promise<void> {
  let taskGraph;
  {
    const taskMap = {} as Record<string, TaskDefX>;
    const stack = [targetName];
    while (stack.length > 0) {
      const taskName = stack.pop()!;
      const taskDef = cx.config.tasks[taskName];
      taskMap[taskName] = taskDef;
      stack.push(...taskDef.dependsOn ?? []);
    }
    taskGraph = buildTaskGraph(taskMap);
  }
  const pendingDepEdges = new Map(
    Object.entries(taskGraph.depEdges).map(([key, val]) => [key, val!]),
  );
  const pendingTasks = [...taskGraph.indie];
  while (pendingTasks.length > 0) {
    const taskName = pendingTasks.pop()!;
    const taskEnv = cx.config.tasks[taskName];

    const installGraph = cx.portInstallGraphs[taskName];
    await using syncCx = await syncCtxFromGhjk(ctx);
    const taskEnvDir = await Deno.makeTempDir({
      prefix: `ghjkTaskEnv_${taskName}_`,
    });
    const { env: installEnvs } = await installFromGraphAndShimEnv(
      syncCx,
      taskEnvDir,
      installGraph,
    );
    logger().info("executing", taskName);
    await execTaskDeno(
      std_path.toFileUrl(ctx.configPath).href,
      taskName,
      args,
      {
        ...installEnvs,
        ...taskEnv.env.env,
      },
    );
    $.removeIfExists(taskEnvDir);

    const dependentTasks = taskGraph.revDepEdges[taskName] ?? [];
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
}
