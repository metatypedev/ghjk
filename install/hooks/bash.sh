# please keep this posix compatible and avoid bash extensions when possible
# the zsh impl also relies on this
# https;//shellcheck.net can come in handy in this

# Define color variables
ansi_red='\033[0;31m'
# GREEN='\033[0;32m'
ansi_yel='\033[0;33m'
# BLUE='\033[0;34m'
ansi_nc='\033[0m' # No Color

init_ghjk() {
    if [ -n "${GHJK_CLEANUP+x}" ]; then
        eval "$GHJK_CLEANUP"
    fi
    unset GHJK_CLEANUP
    unset GHJK_LAST_LOADER_PATH
    unset GHJK_LAST_LOADER_TS
    cur_dir=$PWD
    while [ "$cur_dir" != "/" ]; do
        if [ -e "$cur_dir/ghjk.ts" ]; then
            envDir="$HOME/.local/share/ghjk/envs/$(printf "$cur_dir" | tr '/' '.')"
            if [ -d "$envDir" ]; then
                export GHJK_LAST_LOADER_PATH="$envDir/loader.sh"
                export GHJK_LAST_LOADER_TS=$(stat -c "%Y" "$GHJK_LAST_LOADER_PATH" | tr -d '\n')
                . "$envDir/loader.sh"
                # FIXME: -ot not valid in POSIX
                # shellcheck disable=SC3000-SC4000
                if [ "$envDir/loader.sh" -ot "$cur_dir/ghjk.ts" ]; then
                    printf "${ansi_yel}[ghjk] Detected changes, please sync...${ansi_nc}\n"
                fi
            else
                printf "${ansi_red}[ghjk] Uninstalled runtime found, please sync...${ansi_nc}\n"
                printf "$envDir\n"
            fi
            return
        fi
        cur_dir="$(dirname "$cur_dir")"
    done
}

# onlt load bash-prexec if we detect bash
# bash-preexec itslef only executes if it detects bash
# but even reliably resolving it's address
# requires bash extensions. 
if [ -n "${BASH_SOURCE+x}" ]; then
    myDir=$(dirname -- "$(readlink -f -- "${BASH_SOURCE}")")
    . "$myDir/bash-preexec.sh"
fi

export LAST_PWD="$PWD"
# use precmd to check for ghjk.ts before every prompt draw
# precmd is avail natively for zsh
precmd() {
    if [ "$LAST_PWD" != "$PWD" ] || (
        # if the last detected loader has been touched
        [ -n "${GHJK_LAST_LOADER_PATH+x}" ] && [ $(stat -c "%Y" "$GHJK_LAST_LOADER_PATH" | tr -d '\n') != $(("$GHJK_LAST_LOADER_TS")) ]
    ); then
        echo "got here"
        init_ghjk
        export LAST_PWD="$PWD"
    fi

}

# try loading any relevant ghjk.ts right away
init_ghjk
