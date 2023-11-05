import {
  DownloadEnv,
  ExecPathEnv,
  InstallEnv,
  ListAllEnv,
  ListBinPathsEnv,
  Tool,
} from "../cli/core/tools.ts";
import { runOrExit } from "../cli/utils.ts";

export function node({ version }: { version: string }) {
  return new class extends Tool {
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

    listAll(env: ListAllEnv) {
      const metadataRequest = await fetch(`https://nodejs.org/dist/index.json`);
      const metadata = await metadataRequest.json();

      const versions = metadata.map((v: any) => v.version);
      versions.sort();

      console.log(versions);
      return versions;
    }

    download(env: DownloadEnv) {
      /*
    const infoRequest = await fetch(
      `https://nodejs.org/dist/v21.1.0/node-v21.1.0-darwin-arm64.tar.gz`,
    );
    Deno.writeFile(
      "node-v21.1.0-darwin-arm64.tar.gz",
      infoRequest.body!,
    );
    */
    }

    async install(env: InstallEnv) {
      await Deno.remove(env.ASDF_INSTALL_PATH, { recursive: true });
      await runOrExit(["tar", "-xzf", "node-v21.1.0-darwin-arm64.tar.gz"]);
      await Deno.rename(
        "node-v21.1.0-darwin-arm64",
        env.ASDF_INSTALL_PATH,
      );
    }
  }();
}
