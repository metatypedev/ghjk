interface ASDF_CONFIG_EXAMPLE {
  ASDF_INSTALL_TYPE: "version" | "ref";
  ASDF_INSTALL_VERSION: string; //	full version number or Git Ref depending on ASDF_INSTALL_TYPE
  ASDF_INSTALL_PATH: string; //	the path to where the tool should, or has been installed
  ASDF_CONCURRENCY: number; //	the number of cores to use when compiling the source code. Useful for setting make -j
  ASDF_DOWNLOAD_PATH: string; //	the path to where the source code or binary was downloaded to by bin/download
  ASDF_PLUGIN_PATH: string; //	the path the plugin was installed
  ASDF_PLUGIN_SOURCE_URL: string; //	the source URL of the plugin
  ASDF_PLUGIN_PREV_REF: string; //	prevous git-ref of the plugin repo
  ASDF_PLUGIN_POST_REF: string; //	updated git-ref of the plugin repo
  ASDF_CMD_FILE: string; // resolves to the full path of the file being sourced
}

export interface BinDefaultEnv {
  ASDF_INSTALL_TYPE: "version" | "ref";
  ASDF_INSTALL_VERSION: string;
  ASDF_INSTALL_PATH: string;
}

export interface ListAllEnv {
}

export interface ListBinPathsEnv extends BinDefaultEnv {
}

export interface ExecPathEnv extends BinDefaultEnv {
}

export interface DownloadEnv extends BinDefaultEnv {
  ASDF_DOWNLOAD_PATH: string;
}

export interface InstallEnv extends BinDefaultEnv {
  ASDF_CONCURRENCY: number;
  ASDF_DOWNLOAD_PATH: string;
}

export abstract class Tool {
  abstract name: string;
  abstract dependencies: string[];

  abstract execEnv(
    env: ExecPathEnv,
  ): Promise<Record<string, string>> | Record<string, string>;

  abstract listBinPaths(
    env: ListBinPathsEnv,
  ): Promise<Record<string, string>> | Record<string, string>;

  abstract listAll(env: ListAllEnv): Promise<string[]> | string[];

  abstract download(env: DownloadEnv): Promise<void> | void;

  abstract install(env: InstallEnv): Promise<void> | void;
}
