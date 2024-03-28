import { cliffy_cmd } from "../deps/cli.ts";
import { Blackboard } from "../host/types.ts";
import type { Json } from "../utils/mod.ts";
import type { GhjkCtx, ModuleManifest } from "./types.ts";

export abstract class ModuleBase<Ctx, LockEnt> {
  abstract processManifest(
    ctx: GhjkCtx,
    manifest: ModuleManifest,
    bb: Blackboard,
    lockEnt: LockEnt | undefined,
  ): Promise<Ctx> | Ctx;
  // returns undefined if previous lock entry is no longer valid
  abstract loadLockEntry(
    ctx: GhjkCtx,
    raw: Json,
  ): Promise<LockEnt | undefined> | LockEnt | undefined;
  abstract genLockEntry(
    ctx: GhjkCtx,
    manifest: Ctx,
  ): Promise<Json> | Json;
  abstract command(
    ctx: GhjkCtx,
    pman: Ctx,
  ): cliffy_cmd.Command<any, any, any, any>;
}
