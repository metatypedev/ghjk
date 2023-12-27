export * from "./types.ts";

import { cliffy_cmd, std_path } from "../../deps/cli.ts";
import { $, JSONValue } from "../../utils/mod.ts";

import validators from "./types.ts";
import type { TaskEnvX, TasksModuleConfigX } from "./types.ts";
import type { GhjkCtx, ModuleManifest } from "../types.ts";
import { ModuleBase } from "../mod.ts";
import logger from "../../utils/logger.ts";
import { execTaskDeno } from "./deno.ts";

import {
  buildInstallGraph,
  installAndShimEnv,
  InstallGraph,
} from "../ports/sync.ts";
import { installsDbKv } from "../ports/db.ts";

export type TaskModuleManifest = {
  config: TasksModuleConfigX;
  installGraphs: Record<string, InstallGraph>;
};
export class TasksModule extends ModuleBase<TaskModuleManifest> {
  async processManifest(
    _ctx: GhjkCtx,
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
    return {
      config: res.data,
      installGraphs: Object.fromEntries(
        await Promise.all(
          Object.entries(res.data.tasks)
            .map(async ([name, task]) => [
              name,
              await buildInstallGraph({
                installs: task.env.installs,
                allowedDeps: task.env.allowedPortDeps,
              }),
            ]),
        ),
      ),
    };
  }
  command(
    ctx: GhjkCtx,
    manifest: TaskModuleManifest,
  ) {
    const commands = Object.entries(manifest.config.tasks).map(
      ([name, task]) => {
        let cliffyCmd = new cliffy_cmd.Command()
          .name(name)
          .useRawArgs()
          .action(async (_, ...args) => {
            await execTask(
              ctx,
              name,
              args,
              task.env,
              manifest.installGraphs[name],
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

export async function execTask(
  ctx: GhjkCtx,
  name: string,
  args: string[],
  taskEnv: TaskEnvX,
  installGraph: InstallGraph,
): Promise<void> {
  const portsDir = await $.path(ctx.ghjkDir).resolve("ports")
    .ensureDir();
  using db = await installsDbKv(
    portsDir.resolve("installs.db").toString(),
  );
  const taskEnvDir = await Deno.makeTempDir({
    prefix: `ghjkTaskEnv_${name}_`,
  });
  const { env: installEnvs } = await installAndShimEnv(
    portsDir.toString(),
    taskEnvDir,
    db,
    installGraph,
  );
  logger().info("executing", name);
  await execTaskDeno(
    std_path.toFileUrl(ctx.configPath).href,
    name,
    args,
    {
      ...installEnvs,
      ...taskEnv.vars,
    },
  );
  $.removeIfExists(taskEnvDir);
}
