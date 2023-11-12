import {
  addInstallGlobal,
  denoWorkerPlug,
  DownloadEnv,
  ExecEnvEnv,
  type InstallConfigBase,
  InstallEnv,
  ListAllEnv,
  ListBinPathsEnv,
  logger,
  Plug,
  registerDenoPlugGlobal,
} from "../plug.ts";
import { spawn } from "../cli/utils.ts";
import { std_path } from "../deps/cli.ts";

const manifest = {
  name: "node",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
};

denoWorkerPlug(
  new class extends Plug {
    name = "node";
    dependencies = [];

    execEnv(env: ExecEnvEnv) {
      return {
        NODE_PATH: env.ASDF_INSTALL_PATH,
      };
    }

    listBinPaths(env: ListBinPathsEnv) {
      return [
        "bin/node",
        "bin/npm",
        "bin/npx",
      ];
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
      const resp = await fetch(
        `https://nodejs.org/dist/v21.1.0/node-v21.1.0-darwin-arm64.tar.gz`,
      );
      const dest = await Deno.open(
        std_path.resolve(
          env.ASDF_DOWNLOAD_PATH,
          "node-v21.1.0-darwin-arm64.tar.gz",
        ),
        { create: true, truncate: true, write: true },
      );
      try {
        await resp.body!.pipeTo(dest.writable);
      } finally {
        dest.close();
      }
    }

    async install(env: InstallEnv) {
      await Deno.remove(env.ASDF_INSTALL_PATH, { recursive: true });
      await spawn(["ls", env.ASDF_DOWNLOAD_PATH]);
      await spawn([
        "tar",
        "xf",
        std_path.resolve(
          env.ASDF_DOWNLOAD_PATH,
          "node-v21.1.0-darwin-arm64.tar.gz",
        ),
        `--directory=${std_path.resolve(env.ASDF_INSTALL_PATH)}`,
      ]);
      await Deno.rename(
        "node-v21.1.0-darwin-arm64",
        env.ASDF_INSTALL_PATH,
      );
    }
  }(),
);

registerDenoPlugGlobal(manifest);

export default function node({ version }: InstallConfigBase = {}) {
  addInstallGlobal({
    plugName: manifest.name,
    version,
  });
}
