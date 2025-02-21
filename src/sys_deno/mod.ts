import type { CliCommand } from "./types.ts";
import type { Json } from "../deno_utils/mod.ts";
import type { Blackboard, GhjkCtx, ModuleManifest } from "./types.ts";

export abstract class ModuleBase<LockEnt> {
  constructor(protected gcx: GhjkCtx) {}
  /* init(
    _gcx: GhjkCtx,
  ): Promise<void> | void {} */
  abstract loadConfig(
    manifest: ModuleManifest,
    bb: Blackboard,
    lockEnt: LockEnt | undefined,
  ): Promise<void> | void;
  // returns undefined if previous lock entry is no longer valid
  abstract loadLockEntry(
    raw: Json,
  ): Promise<LockEnt | undefined> | LockEnt | undefined;
  abstract genLockEntry(): Promise<Json> | Json;
  abstract commands(): CliCommand[];
}
