# ghjk

ghjk is a programmable runtime manager.

## Features

- install and manage tools (e.g. rustup, deno, node, etc.)
  - fuzzy match the version
  - support dependencies between tools
- setup runtime helpers (e.g. pre-commit, linting, ignore, etc.)
  - provide a general regex based lockfile
  - enforce custom rules
- create aliases and shortcuts
  - `meta` -> `cargo run -p meta`
  - `x meta` -> `cargo run -p meta` (avoid conflicts and provide autocompletion)
- load environment variables and prompt for missing ones
- define build tasks with dependencies
  - `task("build", {depends_on: [rust], if: Deno.build.os === "Macos" })`
  - `task.bash("ls")`
- compatible with continuous integration (e.g. github actions, gitlab)

## Getting started

```bash
deno run -A https://raw.githubusercontent.com/metatypedev/ghjk/main/install.ts
```

## How it works

The only dependency required is `deno`. Everything else is managed by `ghjk`.
Namely, it will:

- install or upgrade itself using `deno install`
- set up a "directory change" hook in your shell profile
  - `.bashrc`
  - `.zshrc`
  - `.config/fish/config.fish`
- for every visited directory where an upstream `$PWD/ghjk.ts` file exists
  - add the `$HOME/.local/share/ghjk/shims/$PWD` to your `$PATH`
  - source environment variables in `$HOME/.local/share/ghjk/shims/$PWD/loader`
    and clear previously loaded ones

Using the `ghjk install` subcommand, you will

- install the missing tools at `$HOME/.local/share/ghjk/installs`
- regenerate the shims with symlinks and environment variables
- detect any violation of specified rules

Additional subcommands are available:

- `ghjk list`: list installed tools and versions
- `ghjk outdated`: list outdated tools
- `ghjk cleanup`: remove unused tools and versions

## todo

- multiple version of the same package (e.g. rust stable and rust nighted)
- wasmedge
- python with virtual env dir
- poetry
- pnpm
- mold({ if: Deno.build.os === "Macos" })
- hash verifiable dependencies
