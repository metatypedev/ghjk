import { std_path } from "../deps/cli.ts";
import { dirs } from "./utils.ts";
import { spawnOutput } from "../core/utils.ts";

let LD_LIBRARY_ENV: string;
switch (Deno.build.os) {
  case "darwin":
    LD_LIBRARY_ENV = "DYLD_LIBRARY_PATH";
    break;
  case "linux":
    LD_LIBRARY_ENV = "LD_LIBRARY_PATH";
    break;
  default:
    throw new Error(`unsupported os ${Deno.build.os}`);
}

// null means it should be removed (for cleaning up old versions)
const vfs = {
  // the script executed when users use the ghjk command
  "hooks/entrypoint.ts": `
const log = console.log;
console.log = (...args) => {
  log("[ghjk.ts]", ...args);
};
const mod = await import(Deno.args[0]);
console.log = log;
mod.ghjk.runCli(Deno.args.slice(1), mod.options);
    `,

  // the hook run before every prompt draw in bash
  "hooks/hook.sh": `
ghjk_already_run=false

clean_up_paths() {
    PATH=$(echo "$PATH" | tr ':' '\\n' | grep -vE "^$HOME/\\.local/share/ghjk/envs" | tr '\\n' ':')
    PATH="$\{PATH%:\}"
    LIBRARY_PATH=$(echo "$LIBRARY_PATH" | tr ':' '\\n' | grep -vE "^$HOME/\\.local/share/ghjk/envs" | tr '\\n' ':')
    LIBRARY_PATH="$\{LIBRARY_PATH%:\}"
    ${LD_LIBRARY_ENV}=$(echo "$${LD_LIBRARY_ENV}" | tr ':' '\\n' | grep -vE "^$HOME/\\.local/share/ghjk/envs" | tr '\\n' ':')
    ${LD_LIBRARY_ENV}="$\{${LD_LIBRARY_ENV}%:\}"
    C_INCLUDE_PATH=$(echo "$C_INCLUDE_PATH" | tr ':' '\\n' | grep -vE "^$HOME/\\.local/share/ghjk/envs" | tr '\\n' ':')
    C_INCLUDE_PATH="$\{C_INCLUDE_PATH%:\}"
    CPLUS_INCLUDE_PATH=$(echo "$CPLUS_INCLUDE_PATH" | tr ':' '\\n' | grep -vE "^$HOME/\\.local/share/ghjk/envs" | tr '\\n' ':')
    CPLUS_INCLUDE_PATH="$\{CPLUS_INCLUDE_PATH%:\}"
}

ghjk_hook() {
    # Check if the trap has already executed
    if [[ "$ghjk_already_run" = true ]]; then
      return
    fi
    ghjk_already_run=true
    if [[ -v GHJK_CLEANUP ]]; then
        eval $GHJK_CLEANUP
        unset GHJK_CLEANUP
    fi
    cur_dir=$PWD
    while [ "$cur_dir" != "/" ]; do
        if [ -e "$cur_dir/ghjk.ts" ]; then
            envDir="$HOME/.local/share/ghjk/envs/$(echo "$cur_dir" | tr '/' '.')"
            if [ -d "$envDir" ]; then
                clean_up_paths

                PATH="$envDir/shims/bin:$PATH"
                LIBRARY_PATH="$envDir/shims/lib:$LIBRARY_PATH"
                ${LD_LIBRARY_ENV}="$envDir/shims/lib:$${LD_LIBRARY_ENV}"
                C_INCLUDE_PATH="$envDir/shims/include:$C_INCLUDE_PATH"
                CPLUS_INCLUDE_PATH="$envDir/shims/include:$CPLUS_INCLUDE_PATH"
                
                source "$envDir/loader.sh"
                if [ "$envDir/loader.sh" -ot "$cur_dir/ghjk.ts" ]; then
                    echo -e "\e[38;2;255;69;0m[ghjk] Detected changes, please sync...\e[0m"
                fi
            else
                echo -e "\e[38;2;255;69;0m[ghjk] Uninstalled runtime found, please sync...\e[0m"
                echo "$envDir"
            fi
            alias ghjk="deno run -A $HOME/.local/share/ghjk/hooks/entrypoint.ts $cur_dir/ghjk.ts"
            return
        fi
        cur_dir="$(dirname "$cur_dir")"
    done
    clean_up_paths
    alias ghjk="echo 'No ghjk.ts config found.'"
}

trap 'ghjk_hook' DEBUG

set_hook_flag() {
    ghjk_already_run=false
}

if [[ -n "$PROMPT_COMMAND" ]]; then
    PROMPT_COMMAND+=";"
fi

PROMPT_COMMAND+="set_hook_flag;"
`,

  // the hook run before every prompt draw in fish
  "hooks/hook.fish": `
function clean_up_paths
    set --global --path PATH $(string match --invert --regex "^$HOME\/\.local\/share\/ghjk\/envs" $PATH)
    set --global --path LIBRARY_PATH $(string match --invert --regex "^$HOME\/\.local\/share\/ghjk\/envs" $LIBRARY_PATH)
    set --global --path ${LD_LIBRARY_ENV} $(string match --invert --regex "^$HOME\/\.local\/share\/ghjk\/envs" $${LD_LIBRARY_ENV})
    set --global --path C_INCLUDE_PATH $(string match --invert --regex "^$HOME\/\.local\/share\/ghjk\/envs" $C_INCLUDE_PATH)
    set --global --path CPLUS_INCLUDE_PATH $(string match --invert --regex "^$HOME\/\.local\/share\/ghjk\/envs" $CPLUS_INCLUDE_PATH)
end

function ghjk_hook --on-variable PWD
    if set --query GHJK_CLEANUP
        eval $GHJK_CLEANUP
        set --erase GHJK_CLEANUP
    end
    set --local cur_dir $PWD
    while test $cur_dir != "/"
        if test -e $cur_dir/ghjk.ts
            set --local envDir $HOME/.local/share/ghjk/envs/$(string replace --all / . $cur_dir)
            if test -d $envDir
                clean_up_paths

                set --global --prepend PATH $envDir/shims/bin
                set --global --prepend LIBRARY_PATH $envDir/shims/lib
                set --global --prepend ${LD_LIBRARY_ENV} $envDir/shims/lib
                set --global --prepend C_INCLUDE_PATH $envDir/shims/include
                set --global --prepend CPLUS_INCLUDE_PATH $envDir/shims/include

                source $envDir/loader.fish
                if test $envDir/loader.fish -ot $cur_dir/ghjk.ts
                    set_color FF4500
                    echo "[ghjk] Detected changes, please sync..."
                    set_color normal
                end
            else
                set_color FF4500
                echo "[ghjk] Uninstalled runtime found, please sync..."
                echo $envDir
                set_color normal
            end
            alias ghjk "deno run -A $HOME/.local/share/ghjk/hooks/entrypoint.ts $cur_dir/ghjk.ts"
            return
        end
        set cur_dir (dirname $cur_dir)
    end
    clean_up_paths
    alias ghjk "echo 'No ghjk.ts config found.'"
end
ghjk_hook
`,
};

async function detectShell(): Promise<string> {
  let path;

  try {
    path = await spawnOutput([
      "ps",
      "-p",
      String(Deno.ppid),
      "-o",
      "comm=",
    ]);
  } catch (err) {
    const envShell = Deno.env.get("SHELL");
    if (!envShell) {
      throw new Error(`cannot get parent process name: ${err}`);
    }
    path = envShell;
  }
  return std_path.basename(path, ".exe").toLowerCase().trim();
}

async function unpackVFS(baseDir: string): Promise<void> {
  await Deno.mkdir(baseDir, { recursive: true });

  for (const [subpath, content] of Object.entries(vfs)) {
    const path = std_path.resolve(baseDir, subpath);
    if (content === null) {
      await Deno.remove(path);
    } else {
      await Deno.mkdir(std_path.dirname(path), { recursive: true });
      await Deno.writeTextFile(path, content.trim());
    }
  }
}

async function filterAddFile(
  path: string,
  marker: RegExp,
  content: string | null,
) {
  const file = await Deno.readTextFile(path).catch(async (err) => {
    if (err instanceof Deno.errors.NotFound) {
      await Deno.mkdir(std_path.dirname(path), { recursive: true });
      return "";
    }
    throw err;
  });
  const lines = file.split("\n");

  let i = 0;
  while (i < lines.length) {
    if (marker.test(lines[i])) {
      lines.splice(i, 1);
    } else {
      i += 1;
    }
  }

  if (content !== null) {
    lines.push(content);
  }

  await Deno.writeTextFile(path, lines.join("\n"));
}

export async function install() {
  const { homeDir, shareDir } = dirs();
  await unpackVFS(shareDir);
  const shell = await detectShell();
  if (shell === "fish") {
    await filterAddFile(
      std_path.resolve(homeDir, ".config/fish/config.fish"),
      /\.local\/share\/ghjk\/hooks\/hook.fish/,
      "source $HOME/.local/share/ghjk/hooks/hook.fish",
    );
  } else if (shell === "bash") {
    await filterAddFile(
      std_path.resolve(homeDir, ".bashrc"),
      /\.local\/share\/ghjk\/hooks\/hook.sh/,
      "source $HOME/.local/share/ghjk/hooks/hook.sh",
    );
  } else {
    throw new Error(`unsupported shell: ${shell}`);
  }
}
