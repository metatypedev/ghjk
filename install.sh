#!/bin/sh

set -e -u

GHJK_VERSION="${GHJK_VERSION:-v0.2.1}"
GHJK_INSTALLER_URL="${GHJK_INSTALLER_URL:-https://raw.github.com/metatypedev/ghjk/$GHJK_VERSION/install.ts}"
GHJK_SHARE_DIR="${GHJK_SHARE_DIR:-$HOME/.local/share/ghjk}"
DENO_VERSION="${DENO_VERSION:-v1.44.2}"

# make sure the version is prepended with v
if [ "${DENO_VERSION#"v"}" = "$DENO_VERSION" ]; then
    DENO_VERSION="v$DENO_VERSION"
fi

# if custom deno bin is not set, install one
if [ -z "${GHJK_INSTALL_DENO_EXEC+x}" ]; then

    GHJK_INSTALL_DENO_EXEC="$GHJK_SHARE_DIR/bin/deno"
    if [ ! -f "$GHJK_INSTALL_DENO_EXEC" ] || [ "$DENO_VERSION" != "v$("$GHJK_INSTALL_DENO_EXEC" --version | head -n 1 | cut -d ' ' -f 2)" ]; then

        echo "GHJK_INSTALL_DENO_EXEC not set, installing deno $DENO_VERSION for ghjk"

        if ! command -v curl >/dev/null; then
            echo "Error: curl is required to install deno for ghjk." 1>&2
            exit 1
        fi

        curl -fsSL https://deno.land/x/install/install.sh | DENO_INSTALL="$GHJK_SHARE_DIR" sh -s "$DENO_VERSION" >/dev/null
    fi
fi

export GHJK_SHARE_DIR
export GHJK_INSTALL_DENO_EXEC
"$GHJK_INSTALL_DENO_EXEC" run -A "$GHJK_INSTALLER_URL"
