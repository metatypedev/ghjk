#!/bin/sh

set -e -u

GHJK_VERISON="${GHJK_VERISON:-v0.1.0-alpha}"
GHJK_INSTALLER_URL="${GHJK_INSTALLER_URL:-https://raw.github.com/metatypedev/ghjk/$GHJK_VERISON/install.ts}"
GHJK_DIR="${GHJK_DIR:-$HOME/.local/share/ghjk}"
DENO_VERSION="${DENO_VERSION:-v1.38.5}"

# make sure the version is prepended with v
if [ "${DENO_VERSION#"v"}" = "$DENO_VERSION" ]; then
    DENO_VERSION="v$DENO_VERSION"
fi

# if custom deno bin is not set, install one
if [ -z "${GHJK_INSTALL_DENO_EXEC+x}" ]; then
    echo "GHJK_INSTALL_DENO_EXEC not set, installing deno $DENO_VERSION for ghjk"
    if ! command -v curl >/dev/null; then
        echo "Error: curl is required to install deno for ghjk." 1>&2
        exit 1
    fi

    DENO_INSTALL="$GHJK_DIR/tmp/deno-install"
    curl -fsSL https://deno.land/x/install/install.sh | DENO_INSTALL="$DENO_INSTALL" sh -s "$DENO_VERSION" >/dev/null

    # disinterr the deno bin from the install dir
    mv "$DENO_INSTALL/bin/deno" "$GHJK_DIR"
    rm -r "$DENO_INSTALL"

    GHJK_INSTALL_DENO_EXEC="$GHJK_DIR/deno"
fi

(
    # pass all capitalized local vars as env vars
    export $(set | grep "^[A-Z_][A-Z0-9_]*=" | cut -d= -f1)
    "$GHJK_INSTALL_DENO_EXEC" run -A "$GHJK_INSTALLER_URL"
)
