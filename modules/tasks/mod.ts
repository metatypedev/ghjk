export * from "./types.ts";

import { cliffy_cmd, zod } from "../../deps/cli.ts";
import { JSONValue } from "../../utils/mod.ts";

import validators from "./types.ts";
import portValidators from "../ports/types.ts";
import type { TasksModuleConfigX } from "./types.ts";
import type { GhjkCtx, ModuleManifest } from "../types.ts";
import { ModuleBase } from "../mod.ts";

import {
  buildTaskGraph,
  execCtxFromGhjk,
  execTask,
  type TaskGraph,
} from "./exec.ts";
import { getResolutionMemo } from "../ports/sync.ts";

export type TasksCtx = {
  config: TasksModuleConfigX;
  taskGraph: TaskGraph;
};

export class TasksModule extends ModuleBase<TasksCtx> {
  async processManifest(
    ctx: GhjkCtx,
    manifest: ModuleManifest,
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
    const config = res.data;

    await using execCx = await execCtxFromGhjk(ctx);
    const taskGraph = await buildTaskGraph(execCx, config);
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

  async loadLockEntry(
    ctx: GhjkCtx,
    manifest: ModuleManifest,
    raw: JSONValue,
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
    const config = res.data;

    const lockValidator = zod.object({
      version: zod.string(),
      configResolutions: zod.record(
        zod.string(),
        portValidators.installConfigResolved,
      ),
    });
    const { version, configResolutions } = lockValidator.parse(raw);

    if (version != "0") {
      throw new Error(`unexepected version tag deserializing lockEntry`);
    }

    await using execCx = await execCtxFromGhjk(ctx, configResolutions);
    const taskGraph = await buildTaskGraph(execCx, config);
    return { config, taskGraph };
  }

  async genLockEntry(
    gcx: GhjkCtx,
    _tcx: TasksCtx,
  ) {
    const memo = getResolutionMemo(gcx);
    const configResolutions = Object.fromEntries(
      await Array.fromAsync(
        [...memo.entries()].map(async ([key, prom]) => [key, await prom]),
      ),
    );
    return {
      version: "0",
      configResolutions: JSON.parse(JSON.stringify(configResolutions)),
    };
  }
}
