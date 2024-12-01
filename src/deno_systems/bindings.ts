// import "../../src/ghjk/js/mock.sfx.ts";
import { zod } from "../../deps/common.ts";
import { $, Json, unwrapZodRes } from "../../utils/mod.ts";
import type { GhjkCtx, ModuleManifest } from "../../modules/types.ts";
import type { ModuleBase } from "../../modules/mod.ts";
import type { Blackboard } from "../../host/types.ts";
import { Ghjk } from "../ghjk/js/runtime.js";

const prepareArgs = zod.object({
  uri: zod.string(),
  gcx: zod.object({
    ghjkfile_path: zod.string().optional(),
    ghjk_dir_path: zod.string(),
    share_dir_path: zod.string(),
  }),
});

const denoSystemsRoot = zod.object({
  systems: zod.record(zod.function()),
});

type DenoSystemCtor = (gcx: GhjkCtx) => ModuleBase<unknown>;

export type DenoSystemsRoot = {
  systems: Record<string, DenoSystemCtor>;
};

type ManifestDesc = {
  id: string;
  ctor_cb_key: string;
};
type InstanceDesc = {
  load_lock_entry_cb_key: string;
  gen_lock_entry_cb_key: string;
  load_config_cb_key: string;
};

async function prepareSystems(args: zod.infer<typeof prepareArgs>) {
  const gcx = {
    ghjkDir: $.path(args.gcx.ghjk_dir_path),
    ghjkShareDir: $.path(args.gcx.share_dir_path),
    ghjkfilePath: args.gcx.ghjkfile_path
      ? $.path(args.gcx.ghjkfile_path)
      : undefined,
    blackboard: new Map(),
  } satisfies GhjkCtx;

  const { default: mod } = await import(args.uri);
  const { systems } = unwrapZodRes(
    denoSystemsRoot.safeParse(mod),
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
  } satisfies InstanceDesc;
}

// start an interval to prevent the event loop exiting
// after loading systems
setInterval(() => {/* beat */}, 1000);
// FIXME: better means of exit detection, keep alive as long
// as callbacks are registered?
// globalThis.onbeforeunload = (evt) => {
//   evt.preventDefault();
// };

const args = prepareArgs.parse(Ghjk.blackboard.get("args"));
await prepareSystems(args);
