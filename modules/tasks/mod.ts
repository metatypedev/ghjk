export * from "./types.ts";

import { zod } from "../../deps/cli.ts";
import { Json, unwrapZodRes } from "../../utils/mod.ts";

import validators from "./types.ts";
import type { TasksModuleConfigX } from "./types.ts";
import { type ModuleManifest } from "../types.ts";
import { ModuleBase } from "../mod.ts";

import { buildTaskGraph, execTask, type TaskGraph } from "./exec.ts";
import { Blackboard } from "../../host/types.ts";
import { getTasksCtx } from "./inter.ts";
import { CliCommand } from "../../src/deno_systems/types.ts";

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

  override commands() {
    const gcx = this.gcx;
    const tcx = getTasksCtx(this.gcx);

    const namedSet = new Set(tcx.config.tasksNamed);
    const out: CliCommand[] = [{
      name: "tasks",
      visible_aliases: ["x"],
      about: "Tasks module, execute your task programs.",
      before_long_help: "The named tasks in your ghjkfile will be listed here.",
      disable_help_subcommand: true,
      sub_commands: [
        ...Object.keys(tcx.config.tasks)
          .sort()
          .map(
            (key) => {
              const def = tcx.config.tasks[key];
              return {
                name: key,
                about: def.desc,
                hide: !namedSet.has(key),
                args: {
                  raw: {
                    value_name: "TASK ARGS",
                    trailing_var_arg: true,
                    allow_hyphen_values: true,
                    action: "Append",
                  },
                },
                action: async ({ args: { raw } }) => {
                  await execTask(
                    gcx,
                    tcx.config,
                    tcx.taskGraph,
                    key,
                    (raw as string[]) ?? [],
                  );
                },
              } as CliCommand;
            },
          ),
      ],
    }];
    return out;
  }

  loadLockEntry(raw: Json) {
    const entry = lockValidator.parse(raw);

    if (entry.version != "0") {
      throw new Error(`unexpected version tag deserializing lockEntry`);
    }

    return entry;
  }
  genLockEntry() {
    return {
      version: "0",
    };
  }
}
