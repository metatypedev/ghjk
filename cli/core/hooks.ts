import { basename, dirname, resolve } from "../deps.ts";
import { dirs, runAndReturn } from "../utils.ts";

// null means it should be removed (for cleaning up old versions)
const vfs = {
  "hooks/entrypoint.ts": `
const log = console.log;
console.log = (...args) => {
  log("[ghjk.ts]", ...args);
};
const mod = await import(Deno.args[0]);
mod.ghjk.runCli(Deno.args.slice(1));
    `,
  "hooks/hook.sh": `
ghjk_already_run=false

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
    current_dir=$PWD
    while [ "$current_dir" != "/" ]; do
        if [ -e "$current_dir/ghjk.ts" ]; then
            shim="$HOME/.local/share/ghjk/shims/$(echo "$current_dir" | tr '/' '.')"
            if [ -d "$shim" ]; then
                PATH="$shim:$(echo "$PATH" | grep -v "^$HOME\/\.local\/share\/ghjk\/shim")"
                source "$shim/loader.fish"
                if [ "$shim/loader.fish" -ot "$current_dir/ghjk.ts" ]; then
                    echo -e "\e[38;2;255;69;0m[ghjk] Detected changes, please sync...\e[0m"
                fi
            else
                echo -e "\e[38;2;255;69;0m[ghjk] Uninstalled runtime found, please sync...\e[0m"
                echo "$shim"
            fi
            alias ghjk="deno run -A $HOME/.local/share/ghjk/hooks/entrypoint.ts $current_dir/ghjk.ts"
            return
        fi
        cur_dir="$(dirname "$current_dir")"
    done
    alias ghjk "echo 'No ghjk.ts config found.'"
}

trap 'ghjk_hook' DEBUG

set_again() {
    ghjk_already_run=false
}

if [[ -n "$PROMPT_COMMAND" ]]; then
    PROMPT_COMMAND+=";"
fi

PROMPT_COMMAND+="set_again;"
`,
  "hooks/hook.fish": `
function ghjk_hook --on-variable PWD
    if set --query GHJK_CLEANUP
        eval $GHJK_CLEANUP
        set --erase GHJK_CLEANUP
    end
    set --local current_dir $PWD
    while test $current_dir != "/"
        if test -e $current_dir/ghjk.ts
            set --local shim $HOME/.local/share/ghjk/shims/$(string replace --all / . $current_dir)
            if test -d $shim
                set --global PATH $shim $(string match --invert --regex "^$HOME\/\.local\/share\/ghjk\/shim" $PATH)
                source $shim/loader.fish
                if test $shim/loader.fish -ot $current_dir/ghjk.ts
                    set_color FF4500
                    echo "[ghjk] Detected changes, please sync..."
                    set_color normal
                end
            else
                set_color FF4500
                echo "[ghjk] Uninstalled runtime found, please sync..."
                echo $shim
                set_color normal
            end
            alias ghjk "deno run -A $HOME/.local/share/ghjk/hooks/entrypoint.ts $current_dir/ghjk.ts"
            return
        end
        set current_dir (dirname $current_dir)
    end
    alias ghjk "echo 'No ghjk.ts config found.'"
end
ghjk_hook
`,
};

async function detectShell(): Promise<string> {
  const parent = await runAndReturn([
    "ps",
    "-p",
    String(Deno.ppid),
    "-o",
    "comm=",
  ]);
  const path = parent
    .unwrapOrElse((e) => {
      const envShell = Deno.env.get("SHELL");
      if (!envShell) {
        throw new Error(`cannot get parent process name: ${e}`);
      }
      return envShell;
    })
    .trimEnd();
  return basename(path, ".exe").toLowerCase();
}

async function unpackVFS(baseDir: string): Promise<void> {
  await Deno.mkdir(baseDir, { recursive: true });

  for (const [subpath, content] of Object.entries(vfs)) {
    const path = resolve(baseDir, subpath);
    if (content === null) {
      await Deno.remove(path);
    } else {
      await Deno.mkdir(dirname(path), { recursive: true });
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
      await Deno.mkdir(dirname(path), { recursive: true });
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
      resolve(homeDir, ".config/fish/config.fish"),
      /\.local\/share\/ghjk\/hooks\/hook.fish/,
      "source $HOME/.local/share/ghjk/hooks/hook.fish",
    );
  } else if (shell === "bash") {
    await filterAddFile(
      resolve(homeDir, ".bashrc"),
      /\.local\/share\/ghjk\/hooks\/hook.sh/,
      "source $HOME/.local/share/ghjk/hooks/hook.sh",
    );
  } else {
    throw new Error(`unsupported shell: ${shell}`);
  }
}
