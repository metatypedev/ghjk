// NOTE: this mechanism is currently offline for deno systems
// we just
//
// we catch all rejections and explicityly dispatch them to the host
// to avoid shutting down the event loop on uncaught errors
globalThis.addEventListener("unhandledrejection", (evt) => {
  let reason = evt.reason;
  if (reason instanceof Error) {
    reason = reason.stack;
  }
  if (Ghjk.dispatchException(reason)) {
    evt.preventDefault();
  }
});

// start an interval to prevent the event loop exiting
// after loading systems
setInterval(() => {/* beat */}, 1000);

// import "../../src/ghjk/js/mock.sfx.ts";
import { zod } from "../../deps/common.ts";
import { $, unwrapZodRes } from "../../utils/mod.ts";
import type { GhjkCtx, ModuleManifest } from "../../modules/types.ts";
import type { ModuleBase } from "../../modules/mod.ts";
import type { Blackboard } from "../../host/types.ts";
import { Ghjk, Json } from "../ghjk/js/runtime.js";

import type {
  CliCommand,
  CliCommandBindedX,
  DenoSystemsRoot,
} from "./types.ts";
import bindingTypes from "./types.ts";

// FIXME: better means of exit detection, keep alive as long
// as callbacks are registered?
// globalThis.onbeforeunload = (evt) => {
//   evt.preventDefault();
// };

const prepareArgs = zod.object({
  uri: zod.string(),
  config: zod.object({
    ghjkfile: zod.string().optional(),
    ghjkdir: zod.string(),
    data_dir: zod.string(),
    deno_lockfile: zod.string().optional(),
    repo_root: zod.string(),
    deno_dir: zod.string(),
  }),
});

const args = prepareArgs.parse(Ghjk.blackboard.get("args"));
await prepareSystems(args);

async function prepareSystems(args: zod.infer<typeof prepareArgs>) {
  const gcx = {
    ghjkDir: $.path(args.config.ghjkdir),
    ghjkDataDir: $.path(args.config.data_dir),
    ghjkfilePath: args.config.ghjkfile
      ? $.path(args.config.ghjkfile)
      : undefined,
    blackboard: new Map(),
  } satisfies GhjkCtx;

  const { default: mod } = await import(args.uri);
  const { systems } = unwrapZodRes(
    bindingTypes.denoSystemsRoot.safeParse(mod),
  ) as DenoSystemsRoot;

  const manifests = [] as ManifestDesc[];

  for (const [id, ctorFn] of Object.entries(systems)) {
    manifests.push({
      id,
      ctor_cb_key: Ghjk.callbacks.set(
        `sys_ctor_${id}_${crypto.randomUUID()}`,
        () => {
          const instance = ctorFn(gcx);
          return instanceBinding(gcx, id, instance);
        },
      ),
    });
  }
  await Ghjk.hostcall("register_systems", manifests);
}

type ManifestDesc = {
  id: string;
  ctor_cb_key: string;
};

type InstanceDesc = {
  load_lock_entry_cb_key: string;
  gen_lock_entry_cb_key: string;
  load_config_cb_key: string;
  cli_commands_cb_key: string;
};

function instanceBinding(
  gcx: GhjkCtx,
  sys_id: string,
  instance: ModuleBase<unknown>,
) {
  const instanceId = crypto.randomUUID();
  type State = {
    stateKey: string;
  };
  return {
    load_config_cb_key: Ghjk.callbacks.set(
      `sys_load_config_${instanceId}`,
      async (args: Json) => {
        const { config, bb, state: stateRaw } = args as {
          config: ModuleManifest;
          bb: Blackboard;
          state?: State;
        };
        const state = stateRaw?.stateKey
          ? gcx.blackboard.get(stateRaw?.stateKey)
          : undefined;
        await instance.loadConfig({ id: sys_id, config }, bb, state);
        return null;
      },
    ),
    load_lock_entry_cb_key: Ghjk.callbacks.set(
      `sys_load_lock_entry_${instanceId}`,
      async (args: Json) => {
        const { raw } = args as any;
        const state = await instance.loadLockEntry(raw);
        const stateKey = `sys_state_${instanceId}`;
        gcx.blackboard.set(stateKey, state);
        return {
          stateKey,
        } satisfies State;
      },
    ),
    gen_lock_entry_cb_key: Ghjk.callbacks.set(
      `sys_gen_lock_entry_${instanceId}`,
      () => {
        return instance.genLockEntry();
      },
    ),
    cli_commands_cb_key: Ghjk.callbacks.set(
      `sys_cli_commands_${instanceId}`,
      (_) => {
        const commandsRaw = instance.commands();
        return commandsRaw.map((cmd) =>
          commandBinding(cmd) as CliCommandBindedX
        );
      },
    ),
  } satisfies InstanceDesc;
}

function commandBinding(commandRaw: CliCommand): CliCommandBindedX {
  const { action, sub_commands, ...command } = bindingTypes.cliCommand.parse(
    commandRaw,
  );
  const actionId = crypto.randomUUID();
  return {
    ...command,
    sub_commands: sub_commands
      ? sub_commands.map((cmd) => commandBinding(cmd))
      : undefined,
    action_cb_key: action
      ? Ghjk.callbacks.set(
        `sys_cli_command_action_${command.name}_${actionId}`,
        async (args) => {
          const actionArgs = bindingTypes.cliActionArgs.parse(args);
          await action(actionArgs);
          return {};
        },
      )
      : undefined,
  } satisfies CliCommandBindedX;
}
