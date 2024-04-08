# shellcheck disable=SC2148
# keep this posix compatible as it supports bash and zsh

ghjk_reload() {
    if [ -n "${GHJK_CLEANUP_POSIX+x}" ]; then
        # restore previous env
        eval "$GHJK_CLEANUP_POSIX"
    fi
    unset GHJK_CLEANUP_POSIX

    local cur_dir
    local local_ghjk_dir="${GHJK_DIR:-}"
    # if $GHJKFILE is set, set the GHJK_DIR overriding
    # any set by the user
    if [ -n "${GHJKFILE+x}" ]; then
        cur_dir=$(dirname "$GHJKFILE")
        local_ghjk_dir="$cur_dir/.ghjk"
    # if both GHJKFILE and GHJK_DIR are unset
    elif [ -z "$local_ghjk_dir" ]; then
        # look for ghjk dirs in pwd parents
        cur_dir=$PWD
        while true; do
            if [ -d "$cur_dir/.ghjk" ] || [ -e "$cur_dir/ghjk.ts" ]; then
                local_ghjk_dir="$cur_dir/.ghjk"
                break
            fi
            # recursively look in parent directory
            # use do while format to allow detection of .ghjk in root dirs
            next_cur_dir="$(dirname "$cur_dir")"
            if [ "$next_cur_dir" = / ] && [ "$cur_dir" = "/" ]; then
                break
            fi
            cur_dir="$next_cur_dir"
        done
    else
        cur_dir=$(dirname "$local_ghjk_dir")
    fi

    if [ -n "$local_ghjk_dir" ]; then
        # export GHJK_DIR
        # locate the active env
        active_env="${GHJK_ACTIVE_ENV:-default}";
        active_env_dir="$local_ghjk_dir/envs/$active_env"
        if [ -d "$active_env_dir" ]; then
            # load the shim
            # shellcheck source=/dev/null
            . "$active_env_dir/loader.sh"

            # FIXME: -ot not valid in POSIX
            # FIXME: this assumes ghjkfile is of kind ghjk.ts
            # shellcheck disable=SC3000-SC4000
            if [ "$active_env_dir/loader.sh" -ot "$cur_dir/ghjk.ts" ]; then
                printf "\033[0;33m[ghjk] Detected drift from active environment ($active_env), please sync...\033[0m\n"
            fi
        else
            printf "\033[0;31m[ghjk] Active environment ($active_env) not set up, please sync...\033[0m\n"
        fi
    fi
}

# memo to detect directory changes
export GHJK_LAST_PWD="$PWD"
export GHJK_LAST_ACTIVE_ENV="$GHJK_ACTIVE_ENV"

precmd() {
    if [ "$GHJK_LAST_PWD" != "$PWD" ] || [ "$GHJK_LAST_ACTIVE_ENV" != "$GHJK_ACTIVE_ENV" ]; then
        ghjk_reload
        export GHJK_LAST_PWD="$PWD"
        export GHJK_LAST_ACTIVE_ENV="$GHJK_ACTIVE_ENV"
    fi
}

ghjk_reload
