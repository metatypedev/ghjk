function ghjk_reload --on-variable PWD
    if set --query GHJK_CLEANUP_FISH
        # restore previous env
        eval $GHJK_CLEANUP_FISH
    end
    set --erase GHJK_CLEANUP_FISH

    set --local cur_dir $PWD
    while true 
        if test -d $cur_dir/.ghjk
            set --global --export GHJK_DIR $cur_dir/.ghjk
            # locate the default env
            set --local default_env $GHJK_DIR/envs/default
            if test -d $default_env
                # load the shim
                . $default_env/loader.fish

                # FIXME: older versions of fish don't recognize -ot
                # those in debian for example
                # FIXME: this assumes ghjkfile is of kind ghjk.ts
                if test $default_env/loader.fish -ot $cur_dir/ghjk.ts
                    set_color FF4500
                    echo "[ghjk] Detected drift from default environment, please sync..."
                    set_color normal
                end
            else
                set_color FF4500
                echo "[ghjk] No default environment found, please sync..."
                set_color normal
            end
            return
        end
        # recursively look in parent directory
        set --local next_cur_dir (dirname $cur_dir)

        # use do while format to allowe detection of ghjk in root dirs
        if test $next_cur_dir = /; and test $cur_dir = /;
            break
        end
        set cur_dir $next_cur_dir
    end
end

ghjk_reload
