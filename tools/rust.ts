import {
  DownloadEnv,
  ExecPathEnv,
  InstallEnv,
  ListAllEnv,
  ListBinPathsEnv,
  Tool,
} from "../cli/core/tools.ts";

export function rust({ version }: { version: string }) {
  return new class extends Tool {
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
