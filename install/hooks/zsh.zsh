if [ -e ~/.zshenv ]; then . ~/.zshenv; fi
myDir=$(dirname -- "$(readlink -f -- "${(%):-%x}")")
. $myDir/env.sh
