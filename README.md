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
curl -fsSL https://raw.githubusercontent.com/metatypedev/ghjk/main/install.sh | GHJK_VERSION=main bash
```

In your project, create a configuration file `ghjk.ts`:

```ts
export { ghjk } from "https://raw.githubusercontent.com/metatypedev/ghjk/main/mod.ts";
import * as ghjk from "https://raw.githubusercontent.com/metatypedev/ghjk/main/mod.ts";
import node from "https://raw.githubusercontent.com/metatypedev/ghjk/main/ports/node.ts";

ghjk.install(
  node({ version: "14.17.0" }),
);
```

## Development

```bash
cat install.sh | GHJK_INSTALLER_URL=$(pwd)/install.ts bash
```
