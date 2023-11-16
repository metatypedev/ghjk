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
  std_fs,
  std_path,
  std_url,
} from "../plug.ts";
import { spawn } from "../cli/utils.ts";

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
      const url =
        `https://nodejs.org/dist/v21.1.0/node-v21.1.0-darwin-arm64.tar.gz`;
      const fileName = std_url.basename(url);

      const tmpFilePath = std_path.resolve(
        env.tmpDirPath,
        fileName,
      );

      const resp = await fetch(url);
      const dest = await Deno.open(
        tmpFilePath,
        { create: true, truncate: true, write: true },
      );
      await resp.body!.pipeTo(dest.writable, { preventClose: false });
      await Deno.copyFile(
        tmpFilePath,
        std_path.resolve(env.ASDF_DOWNLOAD_PATH, fileName),
      );
    }

    async install(env: InstallEnv) {
      const fileName = "node-v21.1.0-darwin-arm64.tar.gz";
      await spawn([
        "tar",
        "xf",
        std_path.resolve(
          env.ASDF_DOWNLOAD_PATH,
          fileName,
        ),
        `--directory=${env.tmpDirPath}`,
      ]);
      await Deno.remove(env.ASDF_INSTALL_PATH, { recursive: true });
      // FIXME: use Deno.rename when https://github.com/denoland/deno/pull/19879 is merged
      await std_fs.copy(
        std_path.resolve(
          env.tmpDirPath,
          fileName.replace(/\.tar\.gz$/, ""),
        ),
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
