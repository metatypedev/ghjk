function init_ghjk
    if set --query GHJK_CLEANUP
        eval $GHJK_CLEANUP
        set --erase GHJK_CLEANUP
    end
    set --local cur_dir $PWD
    while test $cur_dir != "/"
        if test -e $cur_dir/ghjk.ts
            set --local envDir $HOME/.local/share/ghjk/envs/(string replace --all / . $cur_dir)
            if test -d $envDir
                source $envDir/loader.fish
                if test $envDir/loader.fish -ot $cur_dir/ghjk.ts
                    set_color FF4500
                    echo "[ghjk] Detected changes, please sync..."
                    set_color normal
                end
            else
                set_color FF4500
                echo "[ghjk] Uninstalled runtime found, please sync..."
                echo $envDir
                set_color normal
            end
            return
        end
        set cur_dir (dirname $cur_dir)
    end
end

# try to detect ghjk.ts on each change of PWD
function ghjk_hook --on-variable PWD
    init_ghjk
end

# try loading any relevant ghjk.ts right away
init_ghjk
