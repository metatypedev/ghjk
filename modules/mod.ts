import { cliffy_cmd } from "../deps/cli.ts";
import { Blackboard } from "../host/types.ts";
import type { Json } from "../utils/mod.ts";
import type { GhjkCtx, ModuleManifest } from "./types.ts";

export abstract class ModuleBase<Ctx, LockEnt> {
  /* init(
    _gcx: GhjkCtx,
  ): Promise<void> | void {} */
  abstract processManifest(
    gcx: GhjkCtx,
    manifest: ModuleManifest,
    bb: Blackboard,
    lockEnt: LockEnt | undefined,
  ): Promise<Ctx> | Ctx;
  // returns undefined if previous lock entry is no longer valid
  abstract loadLockEntry(
    gcx: GhjkCtx,
    raw: Json,
  ): Promise<LockEnt | undefined> | LockEnt | undefined;
  abstract genLockEntry(
    gcx: GhjkCtx,
    mcx: Ctx,
  ): Promise<Json> | Json;
  abstract commands(
    gcx: GhjkCtx,
    mcx: Ctx,
  ): Record<string, cliffy_cmd.Command<any>>;
}
