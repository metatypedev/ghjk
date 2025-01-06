function __ghjk_get_mtime_ts 
    switch (uname -s | tr '[:upper:]' '[:lower:]')
        case "linux"
            stat -c "%.Y" $argv
        case "darwin"
            # darwin stat doesn't support ms since epoch so we bring out the big guns
            deno eval 'console.log((await Deno.stat(Deno.args[0])).mtime.getTime())' $argv
            # stat -f "%Sm" -t "%s" $argv
        case "*"
            stat -c "%.Y" $argv
    end
end

function ghjk_hook --on-variable PWD
    # to be consistent with the posix shells
    # we avoid reloading the env on PWD changes
    # if not in an interactive shell
    if not status is-interactive; and test "$argv" = "VARIABLE SET PWD"; 
        return
    end

    # precedence is gven to argv over GHJK_ENV
    set --local next_env $argv[1]
    test -z $next_env; and set next_env "$GHJK_ENV"
    # we ignore previously loaded GHJK_ENV when switching 
    # directories
    test "$argv" = "VARIABLE SET PWD"; and set next_env ""
    test -z $next_env; and set next_env "default"

    if set --query GHJK_CLEANUP_FISH
        # restore previous env
        eval $GHJK_CLEANUP_FISH
        set --erase GHJK_CLEANUP_FISH
    end

    set --local local_ghjk_dir $GHJKDIR
    # if $GHJKFILE is set, set the GHJKDIR overriding
    # any set by the user
    if set --query GHJKFILE
        set local_ghjk_dir (dirname $GHJKFILE)/.ghjk
    # if both GHJKFILE and GHJKDIR are unset
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
        set --global --export GHJK_LAST_GHJKDIR $local_ghjk_dir

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
            if test (__ghjk_get_mtime_ts $next_env_dir/activate.fish) -lt (__ghjk_get_mtime_ts $local_ghjk_dir/../ghjk.ts)
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
function __ghjk_preexec --on-event fish_preexec

    # trigger reload when either 
    # exists
    if set --query GHJK_NEXTFILE; and test -f "$GHJK_NEXTFILE";

        ghjk_hook (cat $GHJK_NEXTFILE)
        rm "$GHJK_NEXTFILE"

    # activate script has reloaded
    else if set --query GHJK_LAST_ENV_DIR; 
        and test -e $GHJK_LAST_ENV_DIR/activate.fish;
        and test (__ghjk_get_mtime_ts $GHJK_LAST_ENV_DIR/activate.fish) -gt $GHJK_LAST_ENV_DIR_MTIME;
        ghjk_hook
    end
end


if set --query GHJK_AUTO_HOOK; and begin;
    test $GHJK_AUTO_HOOK != "0"; 
    and test $GHJK_AUTO_HOOK != "false"; 
    and test $GHJK_AUTO_HOOK != "" 
end; or status is-interactive;
    ghjk_hook
end
