if [ -e ~/.zshenv ]; then . ~/.zshenv; fi
hooksDir=$(dirname -- "$(readlink -f -- "${(%):-%x}")")
echo $hooksDir
. $hooksDir/hook.sh
