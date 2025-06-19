#!/bin/sh

set -e -u

if ! command -v curl >/dev/null; then
    echo "Error: curl is required to install ghjk." 1>&2
    exit 1
fi

if ! command -v tar >/dev/null; then
    echo "Error: tar is required to install ghjk." 1>&2
    exit 1
fi

ORG=metatypedev
REPO=ghjk
EXT=tar.gz
NAME=ghjk
EXE=ghjk

INSTALLER_URL="https://raw.githubusercontent.com/$ORG/$REPO/main/install.sh"
RELEASE_URL="https://github.com/$ORG/$REPO/releases"

LATEST_VERSION=$(curl "$RELEASE_URL/latest" -s -L -I -o /dev/null -w '%{url_effective}')
LATEST_VERSION="v${LATEST_VERSION##*v}"

PLATFORM="${PLATFORM:-}"
TMP_DIR=$(mktemp -d)
GHJK_INSTALL_EXE_DIR="${GHJK_INSTALL_EXE_DIR:-$HOME/.local/bin}"
VERSION="${VERSION:-$LATEST_VERSION}"

if [ "${PLATFORM:-x}" = "x" ]; then
  MACHINE=$(uname -m)
  case "$(uname -s | tr '[:upper:]' '[:lower:]')" in
    "linux")
      case "$MACHINE" in
        "arm64"* | "aarch64"* ) PLATFORM='aarch64-unknown-linux-gnu' ;;
        *"64") PLATFORM='x86_64-unknown-linux-gnu' ;;
      esac
      ;;
    "darwin")
      case "$MACHINE" in
        "arm64"* | "aarch64"* ) PLATFORM='aarch64-apple-darwin' ;;
        *"64") PLATFORM='x86_64-apple-darwin' ;;
      esac
      ;;
    "msys"*|"cygwin"*|"mingw"*|*"_nt"*|"win"*)
      case "$MACHINE" in
        *"64") PLATFORM='x86_64-pc-windows-msvc' ;;
      esac
      ;;
  esac
  if [ "${PLATFORM:-x}" = "x" ]; then
    cat >&2 <<EOF

/!\\ We couldn't automatically detect your operating system. /!\\

To continue with installation, please choose from one of the following values:
- aarch64-unknown-linux-gnu
- x86_64-unknown-linux-gnu
- x86_64-unknown-linux-musl
- aarch64-apple-darwin
- x86_64-apple-darwin
- x86_64-pc-windows-msvc

Then set the PLATFORM environment variable, and re-run this script:
$ curl -fsSL $INSTALLER_URL | PLATFORM=x86_64-unknown-linux-musl bash
EOF
    exit 1
  fi
  printf "Detected platform: %s\n" "$PLATFORM"
fi

printf "Detected version: %s\n" "$VERSION"

# make sure the version is prepended with v
if [ "${VERSION#"v"}" = "$VERSION" ]; then
  cat >&2 <<EOF
WARN: Resolved version "$VERSION" doesn't have "v" prefix. This may affect asset resolution. Expected format: v0.1.0
EOF
fi

ASSET="$NAME-$VERSION-$PLATFORM"
DOWNLOAD_URL="$RELEASE_URL/download/$VERSION/$ASSET.$EXT"

if curl --fail --location --tlsv1.2 --proto '=https' --output "$TMP_DIR/$ASSET.$EXT" "$DOWNLOAD_URL"; then
  printf "Downloaded successfully: %s\n" "$ASSET.$EXT"
else
  cat >&2 <<EOF

/!\\ The asset $ASSET.$EXT doesn't exist. /!\\

To continue with installation, please make sure the release exists in:
$DOWNLOAD_URL

Then set the PLATFORM and VERSION environment variables, and re-run this script:
$ curl -fsSL $INSTALLER_URL | PLATFORM=x86_64-unknown-linux-musl VERSION=<version> bash
EOF
  exit 1
fi

tar -C "$TMP_DIR" -xvzf "$TMP_DIR/$ASSET.$EXT" "$EXE"
chmod +x "$TMP_DIR/$EXE"

if [ "${GHJK_INSTALL_EXE_DIR}" = "." ]; then
  mv "$TMP_DIR/$EXE" .
  printf "\n\n%s has been extracted to your current directory\n" "$EXE"
else
  cat <<EOF

$EXE will be moved to $GHJK_INSTALL_EXE_DIR
Set the GHJK_INSTALL_EXE_DIR environment variable to change the installation directory:
$ curl -fsSL $INSTALLER_URL | GHJK_INSTALL_EXE_DIR=. bash

EOF
  if [ ! -d "${GHJK_INSTALL_EXE_DIR}" ]; then
    mkdir -p "$GHJK_INSTALL_EXE_DIR"
  fi

  if [ -w "${GHJK_INSTALL_EXE_DIR}" ]; then
    mv "$TMP_DIR/$EXE" "$GHJK_INSTALL_EXE_DIR"
    rm -r "$TMP_DIR"
  else
    echo "$GHJK_INSTALL_EXE_DIR is not writable."
    exit 1
  fi
fi

GHJK_INSTALLER_URL="${GHJK_INSTALLER_URL:-https://raw.github.com/$ORG/$REPO/$VERSION/install.ts}"
"$GHJK_INSTALL_EXE_DIR/$EXE" deno run -A "$GHJK_INSTALLER_URL"

# Check if SKIP_SHELL is set to skip shell config
if [ "${SKIP_SHELL:-}" = "1" ]; then
  printf "\nSkipping shell configuration as SKIP_SHELL=1.\n"
  exit 0
fi

# Check if SHELL is set before using it
if [ -z "${SHELL:-}" ]; then
  printf "\nCould not detect your shell (\$SHELL is not set). Skipping shell configuration.\n"
  exit 0
fi

SHELL_TYPE=$(basename "$SHELL")

case $SHELL_TYPE in
  bash|zsh|ksh)
    SHELL_CONFIG="$HOME/.$SHELL_TYPE"rc
    ;;
  fish)
    SHELL_CONFIG="$HOME/.config/fish/config.fish"
    ;;
  *)
    SHELL_CONFIG=""
esac

if [ -n "$SHELL_CONFIG" ]; then
  printf "\nDetected shell: %s\n" "$SHELL_TYPE"
  # Only use read if stdin is a tty
  if [ -t 0 ]; then
    echo "Do you want to append the new PATH to your configuration ($SHELL_CONFIG)? (y/n): " >&2
    read -r answer
    answer=$(echo "$answer" | tr "[:upper:]" "[:lower:]")
  else
    answer="y"
  fi

  case $SHELL_TYPE in
    bash|zsh|ksh)
      APPEND_CMD="export PATH=\"$GHJK_INSTALL_EXE_DIR:\$PATH\""
      ;;
    fish)
      APPEND_CMD="fish_add_path $GHJK_INSTALL_EXE_DIR"
      ;;
  esac

  if [ "$answer" = "y" ] || [ "$answer" = "yes" ]; then
    echo "$APPEND_CMD" >> "$SHELL_CONFIG"
    printf "Path added to %s\nRun 'source %s' to apply changes." "$SHELL_CONFIG" "$SHELL_CONFIG"
  else
    cat <<EOF

Consider adding $GHJK_INSTALL_EXE_DIR to your PATH if it is not already configured.
$ $APPEND_CMD
EOF
  fi
else
  printf "\nConsider adding %s to your PATH if it is not already configured." "$GHJK_INSTALL_EXE_DIR"
fi
