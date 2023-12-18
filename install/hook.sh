# shellcheck disable=SC2148
# keep this posix compatible as it supports bash and zsh

ghjk_reload() {
    if [ -n "${GHJK_CLEANUP_POSIX+x}" ]; then
        # restore previous env
        eval "$GHJK_CLEANUP_POSIX"
    fi
    unset GHJK_CLEANUP_POSIX

    cur_dir=$PWD
    while [ "$cur_dir" != "/" ]; do
        if [ -f "$cur_dir/ghjk.ts" ]; then
            # locate the shim
            env_dir="__GHJK_DIR__/envs/$(printf "%s" "$cur_dir" | tr '/' '.')"
            if [ -d "$env_dir" ]; then
                # load the shim
                # shellcheck source=/dev/null
                . "$env_dir/loader.sh"

                # FIXME: -ot not valid in POSIX
                # shellcheck disable=SC3000-SC4000
                if [ "$env_dir/loader.sh" -ot "$cur_dir/ghjk.ts" ]; then
                    printf "\033[0;33m[ghjk] Detected changes, please sync...\033[0m\n"
                fi
            else
                printf "\033[0;31m[ghjk] Uninstalled runtime found, please sync...\033[0m\n"
            fi
            return
        fi
        # recursively look in parent directory
        cur_dir="$(dirname "$cur_dir")"
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
