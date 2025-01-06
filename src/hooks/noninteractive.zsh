if [ -e ~/.zshenv ]; then . ~/.zshenv; fi
# source sister script
parent_dir=$(dirname -- "$(readlink -f -- "${(%):-%x}")")
. $parent_dir/env.zsh
