export * from "./types.ts";

import { cliffy_cmd, zod } from "../../deps/cli.ts";
import { Json, unwrapParseRes } from "../../utils/mod.ts";

import validators from "./types.ts";
import type { TasksModuleConfigX } from "./types.ts";
import type { GhjkCtx, ModuleManifest } from "../types.ts";
import { ModuleBase } from "../mod.ts";

import { buildTaskGraph, execTask, type TaskGraph } from "./exec.ts";
import { Blackboard } from "../../host/types.ts";

export type TasksCtx = {
  config: TasksModuleConfigX;
  taskGraph: TaskGraph;
};
const lockValidator = zod.object({
  version: zod.string(),
});
type TasksLockEnt = zod.infer<typeof lockValidator>;

export class TasksModule extends ModuleBase<TasksCtx, TasksLockEnt> {
  processManifest(
    gcx: GhjkCtx,
    manifest: ModuleManifest,
    bb: Blackboard,
    _lockEnt: TasksLockEnt | undefined,
  ) {
    function unwrapParseCurry<I, O>(res: zod.SafeParseReturnType<I, O>) {
      return unwrapParseRes<I, O>(res, {
        id: manifest.id,
        config: manifest.config,
        bb,
      }, "error parsing module config");
    }

    const config = unwrapParseCurry(
      validators.tasksModuleConfig.safeParse(manifest.config),
    );

    const taskGraph = buildTaskGraph(gcx, config);
    return {
      config,
      taskGraph,
    };
  }

  commands(
    gcx: GhjkCtx,
    tcx: TasksCtx,
  ) {
    const commands = Object.entries(tcx.config.tasks).map(
      ([name, task]) => {
        const cliffyCmd = new cliffy_cmd.Command()
          .name(name)
          .useRawArgs()
          .action(async (_, ...args) => {
            await execTask(
              gcx,
              tcx.config,
              tcx.taskGraph,
              name,
              args,
            );
          });
        if (task.desc) {
          cliffyCmd.description(task.desc);
        }
        return cliffyCmd;
      },
    );
    const root = new cliffy_cmd.Command()
      .alias("x")
      .action(function () {
        this.showHelp();
      })
      .description("Tasks module.");
    for (const cmd of commands) {
      root.command(cmd.getName(), cmd);
    }
    return {
      tasks: root,
    };
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
