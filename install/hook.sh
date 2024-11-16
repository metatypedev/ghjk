# shellcheck shell=sh
# keep this posix compatible as it supports bash and zsh

__ghjk_get_mtime_ts () {
    case "$(uname -s | tr '[:upper:]' '[:lower:]')" in
        "linux")
            stat -c "%Y" "$1"
        ;;
        "darwin")
            stat -f "%Sm" -t "%s" "$1"
        ;;
        "*")
            stat -c "%Y" "$1"
        ;;
    esac
}

ghjk_hook() {

    # precedence is given to argv over GHJK_ENV
    # which's usually the current active env
    next_env="${1:-${GHJK_ENV:-default}}";

    if [ -n "${GHJK_CLEANUP_POSIX+x}" ]; then
        # restore previous env
        eval "$GHJK_CLEANUP_POSIX"
        unset GHJK_CLEANUP_POSIX
    fi

    local_ghjk_dir="${GHJK_DIR:-}"
    # if $GHJKFILE is set, set the GHJK_DIR overriding
    # any set by the user
    if [ -n "${GHJKFILE+x}" ]; then
        local_ghjk_dir="$(dirname "$GHJKFILE")/.ghjk"
    # if both GHJKFILE and GHJK_DIR are unset
    elif [ -z "$local_ghjk_dir" ]; then
        # look for ghjk dirs in pwd parents
        # use do while format to allow detection of .ghjk in root dirs
        cur_dir=$PWD
        while true; do
            if [ -d "$cur_dir/.ghjk" ] || [ -e "$cur_dir/ghjk.ts" ]; then
                local_ghjk_dir="$cur_dir/.ghjk"
                break
            fi
            # recursively look in parent directory
            next_cur_dir="$(dirname "$cur_dir")"
            if [ "$next_cur_dir" = / ] && [ "$cur_dir" = "/" ]; then
                break
            fi
            cur_dir="$next_cur_dir"
        done
    fi

    if [ -n "$local_ghjk_dir" ]; then
        GHJK_LAST_GHJK_DIR="$local_ghjk_dir"
        export GHJK_LAST_GHJK_DIR

        # locate the next env
        next_env_dir="$local_ghjk_dir/envs/$next_env"

        if [ -d "$next_env_dir" ]; then
            # load the shim
            # shellcheck source=/dev/null
            . "$next_env_dir/activate.sh"
            # export variables to assist in change detection
            GHJK_LAST_ENV_DIR="$next_env_dir"
            GHJK_LAST_ENV_DIR_MTIME="$(__ghjk_get_mtime_ts "$next_env_dir/activate.sh")"
            export GHJK_LAST_ENV_DIR
            export GHJK_LAST_ENV_DIR_MTIME

            # FIXME: this assumes ghjkfile is of kind ghjk.ts
            if [ "$(__ghjk_get_mtime_ts "$local_ghjk_dir/../ghjk.ts")" -gt "$(__ghjk_get_mtime_ts "$next_env_dir/activate.sh")" ]; then
                if [ "$next_env" = "default" ]; then
                    printf "\033[0;33m[ghjk] Possible drift from default environment, please sync...\033[0m\n"
                else
                    printf "\033[0;33m[ghjk] Possible drift from active environment (%s), please sync...\033[0m\n" "$next_env"
                fi

            fi
        else
            if [ "$next_env" = "default" ]; then
                printf "\033[0;31m[ghjk] Default environment not set up, please sync...\033[0m\n"
            else
                printf "\033[0;31m[ghjk] Active environment (%s) not set up, please sync...\033[0m\n" "$next_env"
            fi
        fi
    fi
}

# memo to detect directory changes
export GHJK_LAST_PWD="$PWD"
export GHJK_NEXTFILE="${TMPDIR:-/tmp}/ghjk.nextfile.$$"

precmd() {
    # trigger reload when either 
    #  - the PWD changes
    if [ "$GHJK_LAST_PWD" != "$PWD" ]; then

        # we ignore previously loaded GHJK_ENV when switching 
        # directories
        unset GHJK_ENV
        ghjk_hook
        export GHJK_LAST_PWD="$PWD"

    # -nextfile exists
    elif [ -f "$GHJK_NEXTFILE" ]; then 

        ghjk_hook "$(cat "$GHJK_NEXTFILE")"
        rm "$GHJK_NEXTFILE"

    #  - the env dir loader mtime changes
    elif [ -n "${GHJK_LAST_ENV_DIR+x}" ] && [ "$(__ghjk_get_mtime_ts "$GHJK_LAST_ENV_DIR/activate.sh")" -gt "$GHJK_LAST_ENV_DIR_MTIME" ]; then 

        ghjk_hook

    fi
}

case "$-" in
    *i*) # if the shell variables contain "i"
        # only run the hook in interactive mode
        # and GHJK_AUTO_HOOK is unset/false
        if [ -z "$GHJK_AUTO_HOOK" ] || [ "$GHJK_AUTO_HOOK" != "0" ] && [ "$GHJK_AUTO_HOOK" != "false" ]; then
            ghjk_hook
        fi
    ;;
    *)
        # also run the hook if GHJK_AUTO_HOOK is set
        if [ -n "${GHJK_AUTO_HOOK+x}" ] && [ "$GHJK_AUTO_HOOK" != "0" ] && [ "$GHJK_AUTO_HOOK" != "false" ]; then
            ghjk_hook
        fi
        :
    ;;
esac
