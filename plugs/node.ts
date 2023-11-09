import {
  addInstallGlobal,
  denoWorkerPlug,
  DownloadEnv,
  ExecPathEnv,
  type InstallConfigBase,
  InstallEnv,
  ListAllEnv,
  ListBinPathsEnv,
  Plug,
  registerPlugGlobal,
} from "../plug.ts";
import { runOrExit } from "../cli/utils.ts";

const manifest = {
  name: "node",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
};

denoWorkerPlug(
  new class extends Plug {
    name = "node";
    dependencies = [];

    execEnv(env: ExecPathEnv) {
      return {
        NODE_PATH: env.ASDF_INSTALL_PATH,
      };
    }

    listBinPaths(env: ListBinPathsEnv) {
      return {
        "bin/node": "node",
        "bin/npm": "npm",
        "bin/npx": "npx",
      };
    }

    async listAll(env: ListAllEnv) {
      const metadataRequest = await fetch(`https://nodejs.org/dist/index.json`);
      const metadata = await metadataRequest.json();

      const versions = metadata.map((v: any) => v.version);
      versions.sort();

      return versions;
    }

    async download(env: DownloadEnv) {
      // TODO: download file
      const infoRequest = await fetch(
        `https://nodejs.org/dist/v21.1.0/node-v21.1.0-darwin-arm64.tar.gz`,
      );
      Deno.writeFile(
        "node-v21.1.0-darwin-arm64.tar.gz",
        infoRequest.body!,
      );
    }

    async install(env: InstallEnv) {
      await Deno.remove(env.ASDF_INSTALL_PATH, { recursive: true });
      await runOrExit(["tar", "-xzf", "node-v21.1.0-darwin-arm64.tar.gz"]);
      await Deno.rename(
        "node-v21.1.0-darwin-arm64",
        env.ASDF_INSTALL_PATH,
      );
    }
  }(),
);

registerPlugGlobal(manifest);

export default function node({ version }: InstallConfigBase = {}) {
  addInstallGlobal({
    plugName: manifest.name,
    version,
  });
}
