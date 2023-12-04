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
            set ghjk_alias "deno run --unstable-worker-options -A $HOME/.local/share/ghjk/hooks/entrypoint.ts $cur_dir/ghjk.ts"
            return
        end
        set cur_dir (dirname $cur_dir)
    end
    set ghjk_alias "echo 'No ghjk.ts config found.'"
end

# the alias value could be changed by init_ghjk
# to execute the appropriate cmd based on ghjk.ts
set ghjk_alias "echo 'No ghjk.ts config found.'"
function ghjk
    eval $ghjk_alias $argv
end

# try to detect ghjk.ts on each change of PWD
function ghjk_hook --on-variable PWD
    init_ghjk
end

# try loading any relevant ghjk.ts right away
init_ghjk
