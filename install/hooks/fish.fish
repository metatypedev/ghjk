function init_ghjk
    if set --query GHJK_CLEANUP_FISH
        eval $GHJK_CLEANUP_FISH
    end
    set --erase GHJK_CLEANUP_FISH
    set --erase GHJK_LAST_LOADER_PATH
    set --erase GHJK_LAST_LOADER_TS
    set --local cur_dir $PWD
    while test $cur_dir != /
        if test -e $cur_dir/ghjk.ts
            set --local envDir __GHJK_DIR__/envs/(string replace --all / . $cur_dir)
            if test -d $envDir
                set -g -x GHJK_LAST_LOADER_PATH $envDir/loader.fish
                set -g -x GHJK_LAST_LOADER_TS (date -r "$(stat -f "%m" $envDir/loader.fish)" +%s | tr -d '\n')
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

function ghjk_prompt_hook --on-event fish_prompt
    # only init if the loader has been modified
    if test ! $ghjk_prompt_init_flag; and set --query GHJK_LAST_LOADER_PATH; and test (stat -c "%Y" $GHJK_LAST_LOADER_PATH | tr -d '\n') != $GHJK_LAST_LOADER_TS
        init_ghjk
        set -g ghjk_prompt_init_flag true
    end
    set -g ghjk_prompt_init_flag false
end

# try to detect ghjk.ts on each change of PWD
function ghjk_pwd_hook --on-variable PWD
    init_ghjk
    # set the flag so that the prompt hook doesn't load it again
    set -g ghjk_prompt_init_flag true
end

# try loading any relevant ghjk.ts right away
init_ghjk
