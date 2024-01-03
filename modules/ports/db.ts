// Deno.Kv api is unstable
/// <reference lib="deno.unstable" />

import type {
  DownloadArtifacts,
  InstallArtifacts,
  InstallConfigLite,
  PortManifestX,
} from "./types.ts";

export type InstallRow = {
  installId: string;
  conf: InstallConfigLite;
  manifest: PortManifestX;
  installArts?: InstallArtifacts;
  downloadArts: DownloadArtifacts;
  progress: "downloaded" | "installed";
};

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
