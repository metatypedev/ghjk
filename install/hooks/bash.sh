
# Define color variables
ansi_red='\033[0;31m'
# GREEN='\033[0;32m'
ansi_yel='\033[0;33m'
# BLUE='\033[0;34m'
ansi_nc='\033[0m' # No Color

init_ghjk() {
    if [ -n "${GHJK_CLEANUP+x}" ]; then
        eval "$GHJK_CLEANUP"
        unset GHJK_CLEANUP
    fi
    cur_dir=$PWD
    while [ "$cur_dir" != "/" ]; do
        if [ -e "$cur_dir/ghjk.ts" ]; then
            envDir="$HOME/.local/share/ghjk/envs/$(echo "$cur_dir" | tr '/' '.')"
            if [ -d "$envDir" ]; then
                . "$envDir/loader.sh"
                # FIXME: -ot not valid in POSIX
                # shellcheck disable=SC3000-SC4000
                if [ "$envDir/loader.sh" -ot "$cur_dir/ghjk.ts" ]; then
                    echo "${ansi_yel}[ghjk] Detected changes, please sync...${ansi_nc}"
                fi
            else
                echo "${ansi_red}[ghjk] Uninstalled runtime found, please sync...${ansi_nc}"
                echo "$envDir"
            fi
            export ghjk_alias="deno run --unstable-worker-options -A $HOME/.local/share/ghjk/hooks/entrypoint.ts $cur_dir/ghjk.ts"
            return
        fi
        cur_dir="$(dirname "$cur_dir")"
    done
    export ghjk_alias="echo '${ansi_red}No ghjk.ts config found.${ansi_nc}'"
}

# the alias value could be changed by init_ghjk
# to execute the appropriate cmd based on ghjk.ts
ghjk_alias="echo 'No ghjk.ts config found.'"
ghjk () {
    eval "$ghjk_alias" "$*";
}

# export function for non-interactive use
export -f ghjk
export -f init_ghjk

# bash-preexec only executes if it detects bash
if [ -n "${BASH_SOURCE+x}" ]; then
    hooksDir=$(dirname -- "$(readlink -f -- "${BASH_SOURCE}")")
    . "$hooksDir/bash-preexec.sh"
fi

# use precmd to check for ghjk.ts before every prompt draw
# precmd is avail natively for zsh
precmd() {
    init_ghjk
}

# try loading any relevant ghjk.ts right away
init_ghjk
