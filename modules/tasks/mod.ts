export * from "./types.ts";

import { cliffy_cmd, zod } from "../../deps/cli.ts";
import { Json } from "../../utils/mod.ts";

import validators from "./types.ts";
import type { TasksModuleConfigX } from "./types.ts";
import type { GhjkCtx, ModuleManifest } from "../types.ts";
import { ModuleBase } from "../mod.ts";

import {
  buildTaskGraph,
  execCtxFromGhjk,
  execTask,
  type TaskGraph,
} from "./exec.ts";
import { GlobalEnv } from "../../host/types.ts";

export type TasksCtx = {
  config: TasksModuleConfigX;
  taskGraph: TaskGraph;
};
const lockValidator = zod.object({
  version: zod.string(),
});
type TasksLockEnt = zod.infer<typeof lockValidator>;

export class TasksModule extends ModuleBase<TasksCtx, TasksLockEnt> {
  async processManifest(
    ctx: GhjkCtx,
    manifest: ModuleManifest,
    _lockEnt: TasksLockEnt | undefined,
    env: GlobalEnv,
  ) {
    const res = validators.tasksModuleConfig.safeParse(manifest.config);
    if (!res.success) {
      throw new Error("error parsing module config", {
        cause: {
          config: manifest.config,
          zodErr: res.error,
        },
      });
    }
    const config: TasksModuleConfigX = {
      tasks: Object.fromEntries(
        Object.entries(res.data.tasks).map(
          ([name, task]) => [name, {
            ...task,
            env: {
              ...task.env,
              allowedPortDeps: task.env.allowedPortDeps.map((hash) =>
                env.allowedPortDeps[hash]
              ),
            },
          }],
        ),
      ),
    };

    await using execCx = await execCtxFromGhjk(ctx);
    const taskGraph = await buildTaskGraph(execCx, config, env);
    return {
      config,
      taskGraph,
    };
  }

  command(
    gcx: GhjkCtx,
    tcx: TasksCtx,
  ) {
    const commands = Object.entries(tcx.config.tasks).map(
      ([name, task]) => {
        let cliffyCmd = new cliffy_cmd.Command()
          .name(name)
          .useRawArgs()
          .action(async (_, ...args) => {
            await using execCx = await execCtxFromGhjk(gcx);
            await execTask(
              execCx,
              tcx.config,
              tcx.taskGraph,
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
    _gcx: GhjkCtx,
    raw: Json,
  ) {
    const entry = lockValidator.parse(raw);

    if (entry.version != "0") {
      throw new Error(`unexepected version tag deserializing lockEntry`);
    }

    return entry;
  }
  genLockEntry(
    _gcx: GhjkCtx,
    _tcx: TasksCtx,
  ) {
    return {
      version: "0",
    };
  }
}
