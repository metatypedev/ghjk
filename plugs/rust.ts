import {
  DownloadEnv,
  ExecPathEnv,
  InstallEnv,
  ListAllEnv,
  ListBinPathsEnv,
  Plug,
} from "../plug.ts";

export function rust({ version }: { version: string }) {
  return new class extends Plug {
    name = "rust";
    dependencies = [];

    execEnv(env: ExecPathEnv) {
      throw new Error("Method not implemented.");
      return {};
    }

    listBinPaths(env: ListBinPathsEnv) {
      throw new Error("Method not implemented.");
      return {};
    }

    listAll(env: ListAllEnv) {
      throw new Error("Method not implemented.");
      return [];
    }

    download(env: DownloadEnv) {
      throw new Error("Method not implemented.");
    }

    install(env: InstallEnv) {
      throw new Error("Method not implemented.");
    }
  }();
}
