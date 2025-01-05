# Installer vars

| Env vars                   | Desc                                                                                                                                                      | Default                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `VERSION`             | Git tag/ref of the ghjk repo to install from.                                                                                                             | Latest release tag.                              |
| `GHJK_DATA_DIR`           | Data directory for ghjk installation.                                                                                                                     | `$HOME/.local/share/ghjk`                        |
| `GHJK_INSTALLER_URL`       | Uri to the typescript section of installer script.                                                                                                        | `install.ts` file from the ghjk repo under       |
| `GHJK_INSTALL_EXE_DIR`     | Location to install the `ghjk` exec.                                                                                                                      | `$HOME/.local/bin`                               |
| `GHJK_INSTALL_HOOK_SHELLS` | Comma separated list of shells to hook.                                                                                                                   | `bash,fish,zsh`                                  |
| `GHJK_INSTALL_HOOK_MARKER` | Marker to use when installing shell hooks.                                                                                                                | `ghjk-hook-marker`                               |
|                            |                                                                                                                                                           |                                                  |
