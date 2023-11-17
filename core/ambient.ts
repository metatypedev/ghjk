import {
  type AmbientAccessPlugManifest,
  type DownloadEnv,
  type InstallEnv,
  type ListAllEnv,
  type ListBinPathsEnv,
  Plug,
} from "./types.ts";
import { ChildError, runAndReturn } from "../cli/utils.ts";

export class AmbientAccessPlug extends Plug {
  constructor(public manifest: AmbientAccessPlugManifest) {
    super();
    if (manifest.deps && manifest.deps.length > 0) {
      throw new Error(
        `ambient access plugin has deps ${JSON.stringify(manifest)}`,
      );
    }
  }
  async listAll(_env: ListAllEnv): Promise<string[]> {
    const execPath = await this.pathToExec();
    let versionOut;
    try {
      versionOut = await runAndReturn([
        execPath,
        this.manifest.versionExtractFlag,
      ]);
    } catch (err) {
      if (err instanceof ChildError) {
        new Error(
          `error trying to get version output for "${this.manifest.name}@${this.manifest.version}" using command ${execPath} ${this.manifest.versionExtractFlag}: ${err}`,
          {
            cause: err,
          },
        );
      }
      throw err;
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
    return [matches[0]];
  }

  async listBinPaths(
    _env: ListBinPathsEnv,
  ): Promise<string[]> {
    return [await this.pathToExec()];
  }

  download(_env: DownloadEnv): void | Promise<void> {
    // no op
  }
  install(_env: InstallEnv): void | Promise<void> {
    // no op
  }
  async pathToExec(): Promise<string> {
    try {
      const output = await runAndReturn(["which", this.manifest.execName]);
      return output.trim();
    } catch (err) {
      if (err instanceof ChildError) {
        new Error(
          `error trying to get exec path for "${this.manifest.name}@${this.manifest.version}" for exec name ${this.manifest.execName}: ${err}`,
          {
            cause: err,
          },
        );
      }
      throw err;
    }
  }
}
