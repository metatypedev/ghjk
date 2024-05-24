function __ghjk_get_mtime_ts 
    switch (uname -s | tr '[:upper:]' '[:lower:]')
        case "linux"
            stat -c "%Y" $argv
        case "darwin"
            stat -f "%Sm" -t "%s" $argv
        case "*"
            stat -c "%Y" $argv
    end
end

function ghjk_reload --on-variable PWD --on-event ghjk_env_dir_change
    # precedence is gven to argv over GHJK_ENV
    set --local next_env $argv[1]
    test "$argv" = "VARIABLE SET PWD"; and set next_env ""
    test -z $next_env; and set next_env "$GHJK_ENV"
    test -z $next_env; and set next_env "default"

    if set --query GHJK_CLEANUP_FISH
        # restore previous env
        eval $GHJK_CLEANUP_FISH
        set --erase GHJK_CLEANUP_FISH
    end

    set --local local_ghjk_dir $GHJK_DIR
    # if $GHJKFILE is set, set the GHJK_DIR overriding
    # any set by the user
    if set --query GHJKFILE
        set local_ghjk_dir (dirname $GHJKFILE)/.ghjk
    # if both GHJKFILE and GHJK_DIR are unset
    else if test -z "$local_ghjk_dir"
        # look for ghjk dirs in pwd and parents
        set --local cur_dir $PWD
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
    end

    if test -n "$local_ghjk_dir"
        set --global --export GHJK_LAST_GHJK_DIR $local_ghjk_dir

        # locate the next env
        set --local next_env_dir $local_ghjk_dir/envs/$next_env

        if test -d $next_env_dir
            # load the shim
            . $next_env_dir/activate.fish
            # export variables to assist in change detection
            set --global --export GHJK_LAST_ENV_DIR $next_env_dir
            set --global --export GHJK_LAST_ENV_DIR_MTIME (__ghjk_get_mtime_ts $next_env_dir/activate.fish)

            # FIXME: older versions of fish don't recognize -ot
            # those in debian for example
            # FIXME: this assumes ghjkfile is of kind ghjk.ts
            if test $next_env_dir/activate.fish -ot $local_ghjk_dir/../ghjk.ts
                set_color FF4500
                if test $next_env = "default"
                    echo "[ghjk] Possible drift from default environment, please sync..."
                else
                    echo "[ghjk] Possible drift from active environment ($next_env), please sync..."
                end
                set_color normal
            end
        else
            set_color FF4500
            if test $next_env = "default"
                echo "[ghjk] Default environment not found, please sync..."
            else
                echo "[ghjk] Active environment ($next_env) not found, please sync..."
            end
            set_color normal
        end
    end
end

set --local tmp_dir "$TMPDIR"
test -z $tmp_dir; and set tmp_dir "/tmp"
set --export --global GHJK_NEXTFILE "$tmp_dir/ghjk.nextfile.$fish_pid"

# trigger reload when the env dir loader mtime changes
function __ghjk_postexec --on-event fish_postexec

    # trigger reload when either 
    # exists
    if set --query GHJK_NEXTFILE; and test -f "$GHJK_NEXTFILE";

        ghjk_reload "$(cat $GHJK_NEXTFILE)"
        rm "$GHJK_NEXTFILE"

    # activate script has reloaded
    else if set --query GHJK_LAST_ENV_DIR; 
        and test (__ghjk_get_mtime_ts $GHJK_LAST_ENV_DIR/activate.fish) -gt $GHJK_LAST_ENV_DIR_MTIME;
        ghjk_reload
    end
end

status is-interactive; and ghjk_reload
