// TODO:

// SKETCH
/*
- Host runs ghjk.ts in a "./host/deno.ts" Worker sandbox to get serialized config
- Serialized config describes meta of all specified Tasks
- Host runs ghjk.ts in a Task specific Worker config instructing it to exec task Foo
    - When run in Task Worker, ghjk.ts will only execute the instructed Task
    - ghjk.ts task items are just mainly deno functions.
        - dax is provided by default to make shelling out ergonmic
        - We shim up Port installs in the environment/PATH to make tools avail

This is a pretty much deno agnostic design. Unix inspired.

Host program -> Config program
Host program -> Task program(s)

It just so happens our programs are Workers and the both the tasks
and configs are defined in a single file. The current design should
hopefully make it extensible if that's ever desired.
*/
export * from "./types.ts";

import { cliffy_cmd, std_path } from "../../deps/cli.ts";

import validators from "./types.ts";
import type { TasksModuleConfig } from "./types.ts";
import type { GhjkCtx, ModuleManifest } from "../types.ts";
import { ModuleBase } from "../mod.ts";
import logger from "../../utils/logger.ts";
import { execTaskDeno } from "./deno.ts";

export class TasksModule extends ModuleBase {
  public static init(
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
    return new TasksModule(ctx, res.data);
  }
  constructor(
    public ctx: GhjkCtx,
    public config: TasksModuleConfig,
  ) {
    super();
  }
  command() {
    const tasks = Object.entries(this.config.commands).map(
      ([name, taskCmd]) => {
        let cliffyCmd = new cliffy_cmd.Command()
          .name(name)
          .useRawArgs()
          .action(async (_, ...args) => {
            await execTask(this.ctx, name, args);
          });
        if (taskCmd.description) {
          cliffyCmd = cliffyCmd.description(taskCmd.description);
        }

        return cliffyCmd;
      },
    );
    let root: cliffy_cmd.Command<any, any, any, any> = new cliffy_cmd.Command()
      .alias("run")
      .alias("r")
      .action(function () {
        this.showHelp();
      })
      .description("Tasks module.");
    for (const cmd of tasks) {
      root = root.command(cmd.getName(), cmd);
    }
    return root;
  }
}

export async function execTask(ctx: GhjkCtx, name: string, args: string[]) {
  logger().info("executing", name);
  await execTaskDeno(std_path.toFileUrl(ctx.configPath).href, name, args);
}
