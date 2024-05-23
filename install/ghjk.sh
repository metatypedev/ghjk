#!/bin/sh 

export GHJK_SHARE_DIR="${GHJK_SHARE_DIR:-__GHJK_SHARE_DIR__}" 
export DENO_DIR="${GHJK_DENO_DIR:-__DENO_CACHE_DIR}" 
export DENO_NO_UPDATE_CHECK=1
GHJK_MAIN_URL="${GHJK_MAIN_URL:-__MAIN_TS_URL__}" 

# NOTE: avoid putting too much in here as this is only one 
# method of getting the ghjk bin which is all utlimately optional
# anyways.

# NOTE: keep this in sync with impls in install/exec.ts

# if ghjkfile var is set, set the GHJK_DIR overriding
# any set by the user
if [ -n "${GHJKFILE+x}" ]; then
  GHJK_DIR="$(dirname "$GHJKFILE")/.ghjk"
# if both GHJKFILE and GHJK_DIR are unset
elif [ -z "${GHJK_DIR+x}" ]; then
  # look for ghjk dirs in parents
  cur_dir=$PWD
  while true; do
      if [ -d "$cur_dir/.ghjk" ] || [ -e "$cur_dir/ghjk.ts" ]; then
          GHJK_DIR="$cur_dir/.ghjk"
          break
      fi
      # recursively look in parent directory
      next_cur_dir="$(dirname "$cur_dir")"
      if [ "$next_cur_dir" = / ] && [ "$cur_dir" = "/" ]; then
          break
      fi
      cur_dir="$next_cur_dir"
  done
fi

if [ -n "${GHJK_DIR+x}" ]; then
  export GHJK_DIR
  mkdir -p "$GHJK_DIR"
  lock_flag="--lock $GHJK_DIR/deno.lock"
else
  lock_flag="--no-lock"
fi

# we don't want to quote $lock_flag as it's not exactly a single
# string param to deno
# shellcheck disable=SC2086
exec __DENO_EXEC__ run __UNSTABLE_FLAGS__ -A $lock_flag $GHJK_MAIN_URL "$@"
