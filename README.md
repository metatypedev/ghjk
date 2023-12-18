# ghjk

ghjk /jk/ is a programmable runtime manager.

## Features

- install and manage tools (e.g. rustup, deno, node, etc.)
  - [ ] fuzzy match the version
  - support dependencies between tools
- [ ] setup runtime helpers (e.g. pre-commit, linting, ignore, etc.)
  - [ ] provide a general regex based lockfile
  - enforce custom rules
- [ ] create aliases and shortcuts
  - `meta` -> `cargo run -p meta`
  - `x meta` -> `cargo run -p meta` (avoid conflicts and provide autocompletion)
- [ ] load environment variables and prompt for missing ones
- [ ] define build tasks with dependencies
  - `task("build", {depends_on: [rust], if: Deno.build.os === "Macos" })`
  - `task.bash("ls")`
- [x] compatible with continuous integration (e.g. github actions, gitlab)

## Getting started

```bash
# stable
curl -fsSL https://raw.githubusercontent.com/metatypedev/ghjk/main/install.sh | bash
# latest (main)
curl -fsSL https://raw.githubusercontent.com/metatypedev/ghjk/main/install.sh | GHJK_VERISON=main bash
```

In your project, create a configuration file `ghjk.ts`:

```ts
export { ghjk } from "https://raw.githubusercontent.com/metatypedev/ghjk/main/mod.ts";
import node from "https://raw.githubusercontent.com/metatypedev/ghjk/main/ports/node.ts";

node({ version: "14.17.0" });
```

## How it works

The only required dependency is `deno`. Everything else is managed automatically
and looks as follows (abstracting away some implementation details):

- the installer sets up a directory hook in your shell profile
  - `.bashrc`
  - `.zshrc`
  - `.config/fish/config.fish`
- for every visited directory, the hook looks for `$PWD/ghjk.ts` in the
  directory or its parents, and
  - adds the `$HOME/.local/share/ghjk/envs/$PWD/shims/{bin,lib,include}` to your
    paths
  - sources environment variables in
    `$HOME/.local/share/ghjk/envs/$PWD/loader.{sh,fish}` and clear previously
    loaded ones (if any)
- you can then
  - sync your runtime with `ghjk ports sync` which
    - installs the missing tools at `$HOME/.local/share/ghjk/envs/$PWD/installs`
    - regenerates the shims with symlinks and environment variables
    - detects any violation of the enforced rules
  - [ ] `ghjk list`: list installed tools and versions
  - [ ] `ghjk outdated`: list outdated tools
  - [ ] `ghjk cleanup`: remove unused tools and versions

## Extending `ghjk`

```ts
```

## todo

- multiple version of the same package (e.g. rust stable and rust nighted)
- [ ] python with virtual env dir
  - poetry
  - pre-commit
- [ ] rust toolchain
- hash verifiable dependencies (timestamp)
- hide the `Deno` object in an abstraction
- support windows
- [ ] installation tools
  - [ ] untar
  - [ ] xz
  - [ ] git

## Development

```bash
cat install.sh | GHJK_INSTALLER_URL=$(pwd)/install.ts bash
```
