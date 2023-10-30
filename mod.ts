export async function runOrExit(
  cmd: string[],
  cwd?: string,
  env: Record<string, string> = Deno.env.toObject(),
) {
  const p = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd,
    stdout: "piped",
    stderr: "piped",
    env,
  }).spawn();

  // keep pipe asynchronous till the command exists
  void p.stdout.pipeTo(Deno.stdout.writable, { preventClose: true });
  void p.stderr.pipeTo(Deno.stderr.writable, { preventClose: true });

  const { code, success } = await p.status;
  if (!success) {
    Deno.exit(code);
  }
}

interface GeneralEnvs {
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

/*
hash to detect self update

*/

interface BinDefaultEnv {
  ASDF_INSTALL_TYPE: "version" | "ref";
  ASDF_INSTALL_VERSION: string;
  ASDF_INSTALL_PATH: string;
}

interface ListAllEnv {
}

interface ListBinPathsEnv extends BinDefaultEnv {
}

interface ExecPathEnv extends BinDefaultEnv {
}

interface DownloadEnv extends BinDefaultEnv {
  ASDF_DOWNLOAD_PATH: string;
}

interface InstallEnv extends BinDefaultEnv {
  ASDF_CONCURRENCY: number;
  ASDF_DOWNLOAD_PATH: string;
}

abstract class Plugin {
  abstract name: string;
  abstract dependencies: Plugin[];
  abstract listAll(env: ListAllEnv): Promise<void>;
  abstract download(env: DownloadEnv): Promise<void>;
  abstract install(env: InstallEnv): Promise<void>;
}

export const nodejsPlugin = {
  name: "node",
  dependencies: [],
  execEnv: async (env: ExecPathEnv) => {
    return {
      NODE_PATH: env.ASDF_INSTALL_PATH,
    };
  },
  listBinPaths: async (env: ListBinPathsEnv) => {
    return {
      "bin/node": "node",
      "bin/npm": "npm",
      "bin/npx": "npx",
    };
  },
  listAll: async (env: ListAllEnv) => {
    const metadataRequest = await fetch(`https://nodejs.org/dist/index.json`);
    const metadata = await metadataRequest.json();

    const versions = metadata.map((v: any) => v.version);
    versions.sort();

    console.log(versions);
  },
  download: async (env: DownloadEnv) => {
    /*
    const infoRequest = await fetch(
      `https://nodejs.org/dist/v21.1.0/node-v21.1.0-darwin-arm64.tar.gz`,
    );
    Deno.writeFile(
      "node-v21.1.0-darwin-arm64.tar.gz",
      infoRequest.body!,
    );
    */
  },
  install: async (env: InstallEnv) => {
    await Deno.remove(env.ASDF_INSTALL_PATH, { recursive: true });
    await runOrExit(["tar", "-xzf", "node-v21.1.0-darwin-arm64.tar.gz"]);
    await Deno.rename(
      "node-v21.1.0-darwin-arm64",
      ASDF_INSTALL_PATH,
    );
  },
};

// rust_target
export function rust({ version }: { version: string }) {
  return new class extends Plugin {
    name = "test";
    dependencies = [];

    listAll(env: ListAllEnv): Promise<void> {
      throw new Error("Method not implemented.");
    }
    download(env: DownloadEnv): Promise<void> {
      throw new Error("Method not implemented.");
    }
    install(env: InstallEnv): Promise<void> {
      throw new Error("Method not implemented.");
    }
  }();
}

export const jcoPlugin = {
  name: "jco",
  dependencies: [
    nodejsPlugin,
  ],
  listAll: async (env: ListAllEnv) => {
    const pkg = "@bytecodealliance/jco";
    const metadataRequest = await fetch(`https://registry.npmjs.org/${pkg}`);
    const metadata = await metadataRequest.json();

    const versions = Object.keys(metadata.versions);
    versions.sort();

    console.log(versions);
    console.log(this.dependencies);
  },
  download: async (env: DownloadEnv) => {
  },
  install: async (env: InstallEnv) => {
  },
};

function home_dir(): string | null {
  switch (Deno.build.os) {
    case "linux":
    case "darwin":
      return Deno.env.get("HOME") ?? null;
    case "windows":
      return Deno.env.get("USERPROFILE") ?? null;
    default:
      return null;
  }
}

const home = home_dir();
if (!home) {
  throw new Error("cannot find home dir");
}

interface Install {
  deps: any[];
}

export async function run() {
}

await Deno.mkdir(`${home}/.local/share/ghjk`, { recursive: true });

const enabledPath = "/Users/teostocco/Documents/triage/metatypedev/metatype"
  .replaceAll("/", ".");
const shim = `${home}/.local/share/ghjk/shims/${enabledPath}`;
await Deno.mkdir(shim, { recursive: true });

const ASDF_INSTALL_VERSION = "v21.1.0";
const ASDF_INSTALL_PATH =
  `${home}/.local/share/ghjk/installs/node/${ASDF_INSTALL_VERSION}`;

await Deno.mkdir(
  ASDF_INSTALL_PATH,
  { recursive: true },
);
await nodejsPlugin.install({ ASDF_INSTALL_VERSION, ASDF_INSTALL_PATH });

for (const [bin, link] of Object.entries(await nodejsPlugin.listBinPaths({}))) {
  const linkPath = `${shim}/${link}`;
  await Deno.remove(linkPath, { recursive: true });
  await Deno.symlink(
    `${ASDF_INSTALL_PATH}/${bin}`,
    linkPath,
    { type: "file" },
  );
}

const env = await nodejsPlugin.execEnv({ ASDF_INSTALL_PATH });
const envPath = `${shim}/.env.fish`;
await Deno.writeTextFile(
  `${shim}/.env.fish`,
  Object.entries(env).map(([k, v]) =>
    `set --global --append GHJK_ENV "export ${k}='$k';"; set --global --export ${k} '${v}'`
  ).join("\n"),
);
await Deno.chmod(envPath, 0o755);

/*

function ghjk --on-variable PWD
    if set -q GHJK_ENV
        eval $GHJK_ENV
        set --global GHJK_ENV ""
    end
    set -l current_dir $PWD
    while test $current_dir != "/"
        if test -e $current_dir/ghjk.ts
            set -l shim $HOME/.local/share/ghjk/shims/$(string replace -a / . $current_dir)
            set --global PATH $shim $(string match -rv "^$HOME\/\.local\/share\/ghjk\/shim" $PATH)
            source $shim/.env.fish
            return
        end
        set current_dir (dirname $current_dir)
    end
end

*/
