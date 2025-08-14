//! this loads the ghjk.ts module and executes
//! a task command - based on sys_deno/bindings.ts pattern

//// <reference no-default-lib="true" />
/// <reference lib="deno.worker" />

// all imports in here (except the following two) should be
// dynamic imports as we want to modify the Deno namespace
// before anyone touches it

// NOTE: only import types
import { shimDenoNamespace } from "../../../deno_utils/worker.ts";
import { Ghjk } from "../../../ghjk/js/runtime.js";

// TODO: shim Deno.exit to avoid killing whole program

const _shimHandle = shimDenoNamespace(Deno.env.toObject());

const { zod } = await import("../../../deps.ts");

const execTaskArgs = zod.object({
  uri: zod.string(),
  payload: zod.object({
    key: zod.string(),
    argv: zod.array(zod.string()),
    workingDir: zod.string(),
    envVars: zod.record(zod.string()),
  }),
});

const args = execTaskArgs.parse(Ghjk.blackboard.get("args"));
const resp = await execTask(args);
Ghjk.blackboard.set("resp", resp);

async function execTask(args: typeof execTaskArgs._output) {
  const { setup: setupLogger } = await import("../../../deno_utils/logger.ts");
  setupLogger();

  const mod = await import(args.uri);
  if (!mod.sophon) {
    throw new Error(
      `no sophon found on exported ghjk object from ghjk.ts when executing task: ${args.uri}`,
    );
  }
  const ret = await mod.sophon.execTask(args.payload);
  return { data: ret ?? null };
}
