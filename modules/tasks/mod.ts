export * from "./types.ts";

import { cliffy_cmd, zod } from "../../deps/cli.ts";
import { Json, unwrapZodRes } from "../../utils/mod.ts";

import validators from "./types.ts";
import type { TasksModuleConfigX } from "./types.ts";
import { type ModuleManifest } from "../types.ts";
import { ModuleBase } from "../mod.ts";

import { buildTaskGraph, execTask, type TaskGraph } from "./exec.ts";
import { Blackboard } from "../../host/types.ts";
import { getTasksCtx } from "./inter.ts";

export type TasksCtx = {
  config: TasksModuleConfigX;
  taskGraph: TaskGraph;
};
const lockValidator = zod.object({
  version: zod.string(),
});
type TasksLockEnt = zod.infer<typeof lockValidator>;

export class TasksModule extends ModuleBase<TasksLockEnt> {
  loadConfig(
    manifest: ModuleManifest,
    bb: Blackboard,
    _lockEnt: TasksLockEnt | undefined,
  ) {
    function unwrapParseCurry<I, O>(res: zod.SafeParseReturnType<I, O>) {
      return unwrapZodRes<I, O>(res, {
        id: manifest.id,
        config: manifest.config,
        bb,
      }, "error parsing module config");
    }

    const config = unwrapParseCurry(
      validators.tasksModuleConfig.safeParse(manifest.config),
    );

    const taskGraph = buildTaskGraph(this.gcx, config);

    const tcx = getTasksCtx(this.gcx);
    tcx.config = config;
    tcx.taskGraph = taskGraph;
  }

  commands() {
    const gcx = this.gcx;
    const tcx = getTasksCtx(this.gcx);

    const namedSet = new Set(tcx.config.tasksNamed);
    const commands = Object.keys(tcx.config.tasks)
      .sort()
      .map(
        (key) => {
          const def = tcx.config.tasks[key];
          const cmd = new cliffy_cmd.Command()
            .name(key)
            .useRawArgs()
            .action(async (_, ...args) => {
              await execTask(
                gcx,
                tcx.config,
                tcx.taskGraph,
                key,
                args,
              );
            });
          if (def.desc) {
            cmd.description(def.desc);
          }
          if (!namedSet.has(key)) {
            cmd.hidden();
          }
          return cmd;
        },
      );
    const root = new cliffy_cmd.Command()
      .alias("x")
      .action(function () {
        this.showHelp();
      })
      .description(`Tasks module.

The named tasks in your ghjkfile will be listed here.`);
    for (const cmd of commands) {
      root.command(cmd.getName(), cmd);
    }
    return {
      tasks: root,
    };
  }

  loadLockEntry(raw: Json) {
    const entry = lockValidator.parse(raw);

    if (entry.version != "0") {
      throw new Error(`unexepected version tag deserializing lockEntry`);
    }

    return entry;
  }
  genLockEntry() {
    return {
      version: "0",
    };
  }
}
