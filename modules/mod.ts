import { cliffy_cmd } from "../deps/cli.ts";
import type { JSONValue } from "../utils/mod.ts";
import type { GhjkCtx, ModuleManifest } from "./types.ts";

export abstract class ModuleBase<PMan> {
  abstract processManifest(
    ctx: GhjkCtx,
    manifest: ModuleManifest,
  ): Promise<PMan> | PMan;
  abstract loadLockEntry(
    ctx: GhjkCtx,
    manifest: ModuleManifest,
    raw: JSONValue,
  ): Promise<PMan> | PMan;
  abstract genLockEntry(
    ctx: GhjkCtx,
    manifest: PMan,
  ): Promise<JSONValue> | JSONValue;
  abstract command(
    ctx: GhjkCtx,
    pman: PMan,
  ): cliffy_cmd.Command<any, any, any, any>;
}
