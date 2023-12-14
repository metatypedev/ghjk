#!/bin/sh

set -e -u

GHJK_VERISON="${GHJK_VERISON:-v0.1.0-alpha}"
GHJK_INSTALLER_URL="${GHJK_INSTALLER_URL:-https://raw.github.com/metatypedev/ghjk/$GHJK_VERISON/install.ts}"
GHJK_DIR="${GHJK_DIR:-$HOME/.local/share/ghjk}"
SHELL="${SHELL:-bash}"
DENO_VERSION="${DENO_VERSION:-v1.38.5}"

# if custom deno bin is not set, install one
if [ -z "${GHJK_INSTALL_DENO_EXEC+x}" ]; then
    echo "GHJK_INSTALL_DENO_EXEC not set, installing deno $DENO_VERSION for ghjk"
    if ! command -v curl >/dev/null; then
        echo "Error: curl is required to install ghjk." 1>&2
        exit 1
    fi
    DENO_INSTALL="$GHJK_DIR/deno"
    curl -fsSL https://deno.land/x/install/install.sh | DENO_INSTALL="$DENO_INSTALL" sh -s "$DENO_VERSION"
    GHJK_INSTALL_DENO_EXEC="$DENO_INSTALL/bin/deno"
fi

(
  # pass all capitalized local vars as env vars
  export $(set | grep "^[A-Z_][A-Z0-9_]*=" | cut -d= -f1); 
  "$GHJK_INSTALL_DENO_EXEC" run -A "$GHJK_INSTALLER_URL"
)
