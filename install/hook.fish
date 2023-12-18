function ghjk_reload --on-variable PWD
    if set --query GHJK_CLEANUP_FISH
        # restore previous env
        eval $GHJK_CLEANUP_FISH
    end
    set --erase GHJK_CLEANUP_FISH

    set --local cur_dir $PWD
    while test $cur_dir != /
        if test -e $cur_dir/ghjk.ts
            # locate the shim
            set --local envDir __GHJK_DIR__/envs/(string replace --all / . $cur_dir)
            if test -d $envDir
                # load the shim
                . $envDir/loader.fish

                if test $envDir/loader.fish -ot $cur_dir/ghjk.ts
                    set_color FF4500
                    echo "[ghjk] Detected changes, please sync..."
                    set_color normal
                end
            else
                set_color FF4500
                echo "[ghjk] Uninstalled runtime found, please sync..."
                set_color normal
            end
            return
        end
        # recursively look in parent directory
        set cur_dir (dirname $cur_dir)
    end
end

ghjk_reload
