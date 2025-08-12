#!/bin/sh
# shellcheck disable=SC2016
# shellcheck disable=SC2028

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
# Print shell-specific commands for the user to run manually, with the
# current shell shown last for convenience. We do not modify any files.

current_shell=$(basename "${SHELL:-}")
case "$current_shell" in
  bash|zsh|ksh|fish) : ;; # supported
  *) current_shell="" ;;  # unknown; no special ordering
esac

shells="bash zsh ksh fish"
ordered_shells=""
for sh in $shells; do
  [ "$sh" != "$current_shell" ] && ordered_shells="$ordered_shells $sh"
done
[ -n "$current_shell" ] && ordered_shells="$ordered_shells $current_shell"

echo
echo "Add $GHJK_INSTALL_EXE_DIR to your PATH by running the appropriate command for your shell:"
for sh in $ordered_shells; do
  case "$sh" in
    bash)
      echo
      echo "- Bash (~/.bashrc):"
      echo '```sh'
      echo '# remove any path mods from previous installation'
      echo "sed -i.bak -e '/# ghjk-path-default/d' ~/.bashrc && rm ~/.bashrc.bak"
      echo '# add ghjk to the PATH with marker'
      echo "printf '\nexport PATH=\"${GHJK_INSTALL_EXE_DIR}:"'$PATH'"\" # ghjk-path-default\n' >> ~/.bashrc"
      echo '# source the file to update the current shell'
      echo ". ~/.bashrc"
      echo '```'
      ;;
    zsh)
      echo
      echo "- Zsh (~/.zshrc):"
      echo '```sh'
      echo '# remove any path mods from previous installation'
      echo "sed -i.bak -e '/# ghjk-path-default/d' ~/.zshrc && rm ~/.zshrc.bak"
      echo '# add ghjk to the PATH with marker'
      echo "printf '\nexport PATH=\"${GHJK_INSTALL_EXE_DIR}:"'$PATH'"\" # ghjk-path-default\n' >> ~/.zshrc"
      echo '# source the file to update the current shell'
      echo ". ~/.zshrc"
      echo '```'
      ;;
    ksh)
      echo
      echo "- Ksh (~/.kshrc):"
      echo '```sh'
      echo '# remove any path mods from previous installation'
      echo "sed -i.bak -e '/# ghjk-path-default/d' ~/.kshrc && rm ~/.kshrc.bak"
      echo '# add ghjk to the PATH with marker'
      echo "printf '\nexport PATH=\"${GHJK_INSTALL_EXE_DIR}:"'$PATH'"\" # ghjk-path-default\n' >> ~/.kshrc"
      echo '# source the file to update the current shell'
      echo ". ~/.kshrc"
      echo '```'
      ;;
    fish)
      echo
      echo "- Fish (~/.config/fish/config.fish):"
      echo '```sh'
      echo '# remove any path mods from previous installation'
      echo "sed -i.bak -e '/# ghjk-path-default/d' ~/.config/fish/config.fish && rm ~/.config/fish/config.fish.bak"
      echo '# add ghjk to the PATH with marker'
      echo "printf '\nfish_add_path \"${GHJK_INSTALL_EXE_DIR}\" # ghjk-path-default\n' >> ~/.config/fish/config.fish"
      echo '# source the file to update the current shell'
      echo ". ~/.config/fish/config.fish"
      echo '```'
      ;;
  esac
done
echo
echo "ghjk has been installed to $GHJK_INSTALL_EXE_DIR"
echo "Add $GHJK_INSTALL_EXE_DIR to your PATH by running one of the commands shown above."