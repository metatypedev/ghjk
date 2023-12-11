import {
  type AmbientAccessPortManifest,
  type DownloadArgs,
  type InstallArgs,
  type ListAllArgs,
  type ListBinPathsArgs,
  PortBase,
} from "./types.ts";
import { $ } from "../../utils/mod.ts";

export class AmbientAccessPort extends PortBase {
  constructor(public manifest: AmbientAccessPortManifest) {
    super();
    if (manifest.deps && manifest.deps.length > 0) {
      throw new Error(
        `ambient access plugin has deps ${JSON.stringify(manifest)}`,
      );
    }
  }
  async latestStable(_env: ListAllArgs): Promise<string> {
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

  async listAll(env: ListAllArgs): Promise<string[]> {
    return [await this.latestStable(env)];
  }

  async listBinPaths(
    _env: ListBinPathsArgs,
  ): Promise<string[]> {
    return [await this.pathToExec()];
  }

  download(_env: DownloadArgs): void | Promise<void> {
    // no op
  }
  install(_env: InstallArgs): void | Promise<void> {
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
