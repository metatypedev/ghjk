import type { AmbientAccessPortManifest } from "./types.ts";
import { $ } from "../../deno_utils/mod.ts";
import { PortBase } from "./base.ts";

export class AmbientAccessPort extends PortBase {
  constructor(public manifest: AmbientAccessPortManifest) {
    super();
    // dependencies make no sense for ambient ports
    if (manifest.buildDeps && manifest.buildDeps.length > 0) {
      throw new Error(
        `ambient access plugin has deps ${JSON.stringify(manifest)}`,
      );
    }
  }
  override async latestStable() {
    const execPath = await this.pathToExec();
    let versionOut;
    try {
      versionOut = await $`${execPath} ${this.manifest.versionExtractFlag}`
        .text();
    } catch (err) {
      throw new Error(
        `error trying to get version output for "${this.manifest.name}@${this.manifest.version}" using command ${execPath} ${this.manifest.versionExtractFlag}: ${err}`,
        {
          cause: err,
        },
      );
    }
    const extractionRegex = new RegExp(
      this.manifest.versionExtractRegex,
      this.manifest.versionExtractRegexFlags,
    );
    const matches = versionOut.match(extractionRegex);
    if (!matches) {
      throw new Error(
        `error trying extract version for "${this.manifest.name}@${this.manifest.version}" using regex ${extractionRegex} from output: ${versionOut}`,
      );
    }

    return matches[0];
  }

  async listAll() {
    return [await this.latestStable()];
  }

  override async listBinPaths(): Promise<string[]> {
    return [await this.pathToExec()];
  }

  override async download() {
    // no op
  }

  install() {
    // no op
  }

  async pathToExec(): Promise<string> {
    try {
      const out = await $.which(this.manifest.execName);
      if (!out) {
        throw Error("not found");
      }
      return out;
    } catch (err) {
      throw new Error(
        `error trying to get exec path for "${this.manifest.name}@${this.manifest.version}" for exec name ${this.manifest.execName}: ${err}`,
        {
          cause: err,
        },
      );
    }
  }
}
