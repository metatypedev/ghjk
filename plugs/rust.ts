import {
  DownloadArgs,
  ExecEnvArgs,
  InstallArgs,
  ListAllEnv,
  ListBinPathsArgs,
  Plug,
} from "../plug.ts";

export function rust({ version }: { version: string }) {
  return new class extends Plug {
    name = "rust";
    dependencies = [];

    execEnv(env: ExecEnvArgs) {
      throw new Error("Method not implemented.");
      return {};
    }

    listBinPaths(env: ListBinPathsArgs) {
      throw new Error("Method not implemented.");
      return {};
    }

    listAll(env: ListAllEnv) {
      throw new Error("Method not implemented.");
      return [];
    }

    download(env: DownloadArgs) {
      throw new Error("Method not implemented.");
    }

    install(env: InstallArgs) {
      throw new Error("Method not implemented.");
    }
  }();
}
