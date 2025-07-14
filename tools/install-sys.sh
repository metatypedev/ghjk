#!/bin/sh

# Read the contents of /etc/os-release into a variable
os_release=$(cat /etc/os-release)

case "$os_release" in
  *Ubuntu*|*Debian*|*Linux\ pop-os*)
    # Debian‐based
    sudo apt update && sudo apt install -y --no-install-recommends \
    libclang-dev `# for libsqlite` \
    fish zsh bash `# for tests`
    ;;
  *Fedora*|*Red\ Hat*|*CentOS*)
    # Red Hat–based
    sudo dnf install -y \
    clang-devel \
    fish zsh bash
    ;;
  *)
    # Fallback
    echo "unable to determine platform" >&2
    echo "install the following manually:" >&2
    echo "- clang development libs" >&2
    echo "- bash shell" >&2
    echo "- fish shell" >&2
    echo "- zsh shell" >&2
    exit 1
    ;;
esac
