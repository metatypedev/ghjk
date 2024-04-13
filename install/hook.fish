
function get_ctime_ts 
    switch (uname -s | tr '[:upper:]' '[:lower:]')
        case "linux"
            stat -c "%Y" $argv
        case "darwin"
            stat -f "%Sm" -t "%s" $argv
        case "*"
            stat -c "%Y" $argv
    end
end

function ghjk_reload --on-variable PWD --on-event ghjk_env_dir_change # --on-variable GHJK_ENV
    if set --query GHJK_CLEANUP_FISH
        # restore previous env
        eval $GHJK_CLEANUP_FISH
        set --erase GHJK_CLEANUP_FISH
    end

    set --local cur_dir
    set --local local_ghjk_dir $GHJK_DIR
    # if $GHJKFILE is set, set the GHJK_DIR overriding
    # any set by the user
    if set --query GHJKFILE
        set cur_dir (dirname $GHJKFILE)
        set local_ghjk_dir $cur_dir/.ghjk
    # if both GHJKFILE and GHJK_DIR are unset
    else if test -z "$local_ghjk_dir"
        # look for ghjk dirs in pwd and parents
        set cur_dir $PWD
        while true 
            if test -d $cur_dir/.ghjk; or test -d $cur_dir/ghjk.ts
                set local_ghjk_dir $cur_dir/.ghjk
                break
            end
            # recursively look in parent directory
            set --local next_cur_dir (dirname $cur_dir)

            # use do while format to allow detection of .ghjk in root dirs
            if test $next_cur_dir = /; and test $cur_dir = /;
                break
            end
            set cur_dir $next_cur_dir
        end
    else 
        set cur_dir (dirname $local_ghjk_dir)
    end

    if test -n "$local_ghjk_dir"
        # locate the active env
        set --local active_env "$GHJK_ENV"
        test -z $active_env; and set --local active_env default
        set --local active_env_dir $local_ghjk_dir/envs/$active_env
        if test -d $active_env_dir
            # load the shim
            . $active_env_dir/activate.fish
            # export variables to assist in change detection
            set --global --export GHJK_LAST_ENV_DIR $active_env_dir
            set --global --export GHJK_LAST_ENV_DIR_CTIME (get_ctime_ts $active_env_dir/activate.fish)

            # FIXME: older versions of fish don't recognize -ot
            # those in debian for example
            # FIXME: this assumes ghjkfile is of kind ghjk.ts
            if test $active_env_dir/activate.fish -ot $cur_dir/ghjk.ts
                set_color FF4500
                if test $active_env = "default"
                    echo "[ghjk] Possible drift from default environment, please sync..."
                else
                    echo "[ghjk] Possible drift from active environment ($active_env), please sync..."
                end
                set_color normal
            end
        else
            set_color FF4500
            if test $active_env = "default"
                echo "[ghjk] Default environment not found, please sync..."
            else
                echo "[ghjk] Active environment ($active_env) not found, please sync..."
            end
            set_color normal
        end
    end
end

# trigger reload when the env dir loader ctime changes
function ghjk_env_dir_watcher --on-event fish_postexec
    if set --query GHJK_LAST_ENV_DIR; and test (get_ctime_ts $GHJK_LAST_ENV_DIR/activate.fish) -gt "$GHJK_LAST_ENV_DIR_CTIME"
        emit ghjk_env_dir_change
    end
end

ghjk_reload
