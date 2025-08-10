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
- aarch64-apple-darwin
- x86_64-apple-darwin

Then set the PLATFORM environment variable, and re-run this script:
$ curl -fsSL $INSTALLER_URL | PLATFORM=x86_64-unknown-linux-gnu bash
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

# Minimal multi-shell hooking using a single line with a marker
has_sed=0; has_grep=0
if command -v sed >/dev/null 2>&1; then has_sed=1; fi
if command -v grep >/dev/null 2>&1; then has_grep=1; fi

MARKER="# ghjk-path-default"
DIR="$GHJK_INSTALL_EXE_DIR"

# Build list of shells to consider
HOOK_SHELLS_INPUT="${GHJK_INSTALL_HOOK_SHELLS:-}"
if [ -n "$HOOK_SHELLS_INPUT" ]; then
  HOOK_SHELLS_INPUT=$(printf "%s" "$HOOK_SHELLS_INPUT" | tr '[:upper:]' '[:lower:]' | tr -d ' ')
else
  HOOK_SHELLS_INPUT="bash,zsh,ksh,fish"
fi


# Gather candidate rc files per requested shells
PAIRS=""
add_pair() {
  pair="$1"; file_path=${pair#*:}
  for existing in $PAIRS; do
    [ "${existing#*:}" = "$file_path" ] && return 0
  done
  PAIRS="$PAIRS $pair"
}

OLD_IFS=$IFS; IFS=,; set -- $HOOK_SHELLS_INPUT; IFS=$OLD_IFS
for shell_name in "$@"; do
  case "$shell_name" in
    bash)
      [ -f "$HOME/.bashrc" ] && add_pair "bash:$HOME/.bashrc"
      ;;
    zsh)
      [ -f "$HOME/.zshrc" ] && add_pair "zsh:$HOME/.zshrc"
      ;;
    ksh)
      [ -f "$HOME/.kshrc" ] && add_pair "ksh:$HOME/.kshrc"
      ;;
    fish)
      [ -f "$HOME/.config/fish/config.fish" ] && add_pair "fish:$HOME/.config/fish/config.fish"
      ;;
  esac
done


if [ -z "$PAIRS" ]; then
  printf "\nNo shell rc files discovered. You may add %s to your PATH manually.\n" "$DIR"
  exit 0
fi

printf "\nPreparing to update the following rc files to add %s to your PATH:\n" "$DIR"
for pair in $PAIRS; do echo " - ${pair#*:}"; done

answer="y"
if [ -t 0 ]; then
  printf "Do you want to proceed? (y/n): " >&2
  read -r answer
  answer=$(echo "$answer" | tr '[:upper:]' '[:lower:]')
fi

if [ "$answer" != "y" ] && [ "$answer" != "yes" ]; then
  printf "\nSkipped modifying shell configuration.\n"
  exit 0
fi

update_rc_file() {
  shell_type="$1"; rc_file="$2"
  rc_dir=$(dirname "$rc_file"); [ -d "$rc_dir" ] || mkdir -p "$rc_dir"

  # Remove existing marker if possible; else skip if marker found with grep; else append anyway
  if [ -f "$rc_file" ] && [ $has_sed -eq 1 ]; then
    tmp_file=$(mktemp)
    if sed -e "/$MARKER/d" "$rc_file" > "$tmp_file"; then mv "$tmp_file" "$rc_file"; else rm -f "$tmp_file"; fi
  elif [ -f "$rc_file" ] && [ $has_grep -eq 1 ]; then
    if grep -Fq "$MARKER" "$rc_file"; then return 0; fi
  fi

  case "$shell_type" in
    bash|zsh|ksh)
      printf '%s\n' "export PATH=\"$DIR:\$PATH\" $MARKER" >> "$rc_file"
      ;;
    fish)
      printf '%s\n' "fish_add_path \"$DIR\" $MARKER" >> "$rc_file"
      ;;
  esac
}

for pair in $PAIRS; do
  shell_type=${pair%%:*}; rc_file=${pair#*:}
  update_rc_file "$shell_type" "$rc_file"
  printf "Updated %s\n" "$rc_file"
done

printf "\nTo apply changes now, run:\n"
for pair in $PAIRS; do rc_file=${pair#*:}; printf " - source %s\n" "$rc_file"; done
