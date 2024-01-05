# shellcheck disable=SC2148
# keep this posix compatible as it supports bash and zsh

ghjk_reload() {
    if [ -n "${GHJK_CLEANUP_POSIX+x}" ]; then
        # restore previous env
        eval "$GHJK_CLEANUP_POSIX"
    fi
    unset GHJK_CLEANUP_POSIX

    cur_dir=$PWD
    # FIXME: this doesn't detect ghjkdirs in root
    while true; do
        if [ -d "$cur_dir/.ghjk" ]; then
            export GHJK_DIR="$cur_dir/.ghjk"
            # locate the default env
            default_env="$GHJK_DIR/envs/default"
            if [ -d "$default_env" ]; then
                # load the shim
                # shellcheck source=/dev/null
                . "$default_env/loader.sh"

                # FIXME: -ot not valid in POSIX
                # FIXME: this assumes ghjkfile is of kind ghjk.ts
                # shellcheck disable=SC3000-SC4000
                if [ "$default_env/loader.sh" -ot "$cur_dir/ghjk.ts" ]; then
                    printf "\033[0;33m[ghjk] Detected drift from default environment, please sync...\033[0m\n"
                fi
            else
                printf "\033[0;31m[ghjk] No default runtime found, please sync...\033[0m\n"
            fi
            return
        fi
        # recursively look in parent directory
        next_cur_dir="$(dirname "$cur_dir")"
        if [ "$next_cur_dir" = / ] && [ "$cur_dir" = "/" ]; then
            break
        fi
    done
}

# memo to detect directory changes
export GHJK_LAST_PWD="$PWD"

precmd() {
    if [ "$GHJK_LAST_PWD" != "$PWD" ]; then
        ghjk_reload
        export GHJK_LAST_PWD="$PWD"
    fi
}

ghjk_reload
