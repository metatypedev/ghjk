// Deno.Kv api is unstable
/// <reference lib="deno.unstable" />

import { zod } from "../../deps/common.ts";
// import type { PathRef } from "../../utils/mod.ts";
// import { $ } from "../../utils/mod.ts";
import validators from "./types.ts";
// import getLogger from "../../utils/logger.ts";

// const logger = getLogger(import.meta);

// NOTE: make sure any changes to here are backwards compatible
const installRowValidator = zod.object({
  // version: zod.string(),
  installId: zod.string(),
  conf: validators.installConfigResolved,
  manifest: validators.portManifest,
  installArts: validators.installArtifacts.nullish(),
  downloadArts: validators.downloadArtifacts,
  progress: zod.enum(["downloaded", "installed"]),
}).passthrough();

type InstallRowVersioned = zod.infer<typeof installRowValidator>;
// FIXME: this breaks typescript
// export type InstallRow = Omit<InstallRowVersioned, "version">;
export type InstallRow = InstallRowVersioned;

export abstract class InstallsDb {
  abstract all(): Promise<InstallRow[]>;
  abstract get(id: string): Promise<InstallRow | undefined>;
  abstract set(id: string, row: InstallRow): Promise<void>;
  abstract delete(id: string): Promise<void>;
  abstract [Symbol.dispose](): void;
}

export async function installsDbKv(path: string): Promise<InstallsDb> {
  const kv = await Deno.openKv(path);
  return new DenoKvInstallsDb(kv);
}

class DenoKvInstallsDb extends InstallsDb {
  prefix = "installs";
  closed = false;
  constructor(public kv: Deno.Kv) {
    super();
  }
  async all(): Promise<InstallRow[]> {
    const iterator = this.kv.list<InstallRow>({ prefix: [this.prefix] });
    return (await Array.fromAsync(iterator)).map((ent) => ent.value);
  }
  async get(id: string) {
    const val = await this.kv.get<InstallRow>([this.prefix, id]);
    if (!val.value) return;
    return val.value;
  }
  async set(id: string, row: InstallRow) {
    const res = await this.kv.set([this.prefix, id], row);
    if (!res.ok) {
      throw new Error("Error on to Deno.Kv.set");
    }
  }
  async delete(id: string) {
    await this.kv.delete([this.prefix, id]);
  }
  [Symbol.dispose](): void {
    if (!this.closed) {
      this.closed = true;
      this.kv.close();
    }
  }
}

/* // TODO: implement me

class InlineInstallsDb extends InstallsDb {
  #map = new Map<string, InstallRowVersioned>();
  #dbDir: PathRef;
  constructor(
    dbDir: string,
  ) {
    super();
    this.#dbDir = $.path(dbDir);
  }
  all(): Promise<InstallRow[]> {
    throw new Error("Method not implemented.");
  }
  async get(id: string): Promise<InstallRow | undefined> {
    let row = this.#map.get(id);
    if (!row) {
      const raw = await this.#dbDir.join(`${id}.meta`).readMaybeText();
      if (raw) {
        try {
          const rawParsed = installRowValidator.parse(JSON.parse(raw));
          if (rowParsed.version != "0") {
            throw new Error(`unexpected version string: ${rowParsed.version}`);
          }
          row = rowParsed;
          this.#map.set(id, row);
        } catch (err) {
          logger.warn(`error parsing install meta for "${id}"`, err);
        }
      }
    }
    return row;
  }
  set(id: string, row: InstallRow): Promise<void> {
    const versioned =  { ...row, version: "0" };
    await this.#dbDir.join(`${id}.meta`).writeJsonPretty(versioned);
    this.#map.set(id, versioned);
    throw new Error("Method not implemented.");
  }
  delete(id: string): Promise<void> {
    this.#map.delete(id);
    throw new Error("Method not implemented.");
  }
  [Symbol.dispose](): void {
    throw new Error("Method not implemented.");
  }
} */
