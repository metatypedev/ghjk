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

ghjk_reload() {
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
        # locate the active env
        # precedence is given to argv over GHJK_ENV
        active_env="${1:-${GHJK_ENV:-default}}";
        active_env_dir="$local_ghjk_dir/envs/$active_env"

        if [ -d "$active_env_dir" ]; then
            # load the shim
            # shellcheck source=/dev/null
            . "$active_env_dir/activate.sh"
            # export variables to assist in change detection
            GHJK_LAST_ENV_DIR="$active_env_dir"
            GHJK_LAST_ENV_DIR_mtime="$(__ghjk_get_mtime_ts "$active_env_dir/activate.sh")"
            export GHJK_LAST_ENV_DIR
            export GHJK_LAST_ENV_DIR_mtime

            # FIXME: this assumes ghjkfile is of kind ghjk.ts
            if [ "$(__ghjk_get_mtime_ts "$local_ghjk_dir/../ghjk.ts")" -gt "$(__ghjk_get_mtime_ts "$active_env_dir/activate.sh")" ]; then
                if [ "$active_env" = "default" ]; then
                    printf "\033[0;33m[ghjk] Possible drift from default environment, please sync...\033[0m\n"
                else
                    printf "\033[0;33m[ghjk] Possible drift from active environment (%s), please sync...\033[0m\n" "$active_env"
                fi

            fi
        else
            if [ "$active_env" = "default" ]; then
                printf "\033[0;31m[ghjk] Default environment not set up, please sync...\033[0m\n"
            else
                printf "\033[0;31m[ghjk] Active environment (%s) not set up, please sync...\033[0m\n" "$active_env"
            fi
        fi
    fi
}

# memo to detect directory changes
export GHJK_LAST_PWD="$PWD"
GHJK_LAST_PROMPT_TS="$(date "+%s")"
export GHJK_LAST_PROMPT_TS

precmd() {
    cur_ts=$(date "+%s")
    # trigger reload when either 
    if [ -n "${GHJK_LAST_GHJK_DIR+x}" ] && 
        nextfile="$GHJK_LAST_GHJK_DIR/envs/next" &&
        nextfile_mtime="$(__ghjk_get_mtime_ts "$nextfile")" &&
        # - nextfile was touched after last command
        [ "$nextfile_mtime" -gt "$GHJK_LAST_PROMPT_TS" ] &&  
        #   and younger than 2 seconds 
        [ $(( "$cur_ts" - "$nextfile_mtime" )) -lt 2 ]; then 

        ghjk_reload $(cat "$nextfile")

    #  - the PWD changes
    elif [ "$GHJK_LAST_PWD" != "$PWD" ] || 
        #  - the env dir loader mtime changes
        [ "$(__ghjk_get_mtime_ts "$GHJK_LAST_ENV_DIR/activate.sh")" -gt "$GHJK_LAST_ENV_DIR_mtime" ]; then 

        ghjk_reload
        export GHJK_LAST_PWD="$PWD"

    fi
    GHJK_LAST_PROMPT_TS="$cur_ts"
}

ghjk_reload
