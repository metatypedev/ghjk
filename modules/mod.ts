import { Blackboard } from "../host/types.ts";
import { CliCommand } from "../src/deno_systems/types.ts";
import type { Json } from "../utils/mod.ts";
import type { GhjkCtx, ModuleManifest } from "./types.ts";

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
