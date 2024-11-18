# Installer vars

| Env vars                   | Desc                                                                                                                                                      | Default                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `GHJK_VERSION`             | Git tag/ref of the ghjk repo to install from.                                                                                                             | Latest release tag.                              |
| `GHJK_SHARE_DIR`           | Root directory for ghjk installation.                                                                                                                     | `$HOME/.local/share/ghjk`                        |
| `GHJK_INSTALLER_URL`       | Uri to the typescript section of installer script.                                                                                                        | `install.ts` file from the ghjk repo under       |
| `GHJK_INSTALL_EXE_DIR`     | Location to install the `ghjk` exec.                                                                                                                      | `$HOME/.local/bin`                               |
| `GHJK_INSTALL_SKIP_EXE`    | Weather or not to skip install the `ghjk` CLI to `GHJK_INSTALL_EXE_DIR`.                                                                                  | `false`                                          |
| `GHJK_INSTALL_DENO_EXEC`   | Alternative deno exec to use. If provided, no separate Deno CLI is downloaded. It's generally preferable for ghjk to manage it's own Deno versions still. | A Deno CLI is installed to `$GHJK_SHARE_DIR/bin` |
| `DENO_VERSION`             | Deno version to install if `GHJK_INSTALL_DENO_EXEC` is not test.                                                                                          | Deno version used for ghjk development.          |
| `GHJK_INSTALL_HOOK_SHELLS` | Comma separated list of shells to hook.                                                                                                                   | `bash,fish,zsh`                                  |
| `GHJK_INSTALL_HOOK_MARKER` | Marker to use when installing shell hooks.                                                                                                                | `ghjk-hook-marker`                               |
|                            |                                                                                                                                                           |                                                  |
| `GHJK_INSTALL_NO_LOCKFILE` | Disable use of a Deno lockfile for the ghjk program.                                                                                                      |                                                  |