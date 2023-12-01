if [ -e ~/.zshenv ]; then . ~/.zshenv; fi
hooksDir=$(dirname -- "$(readlink -f -- "\${(%):-%x}")")
. $hooksDir/hook.sh
