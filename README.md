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
// NOTE: All the calls in your `ghjk.ts` file are ultimately modifying the ghjk object
// exported here.
export { ghjk } from "https://raw.githubusercontent.com/metatypedev/ghjk/main/mod.ts";
import {
  install,
  task,
} from "https://raw.githubusercontent.com/metatypedev/ghjk/main/mod.ts";
import node from "https://raw.githubusercontent.com/metatypedev/ghjk/main/ports/node.ts";

// install programs into your env
install(
  node({ version: "14.17.0" }),
);

// write simple scripts and execute them through
// `$ ghjk x greet`
task("greet", async ({ $, argv: [name] }) => {
  await $`echo Hello ${name}!`;
});
```

Use the following command to then access your environment:

```shell
$ ghjk sync
```

### Environments

Ghjk is primarily configured through constructs called "environments" or "envs"
for short. They serve as recipes for making reproducable (mostly) posix shells.

```ts
export { ghjk } from "https://raw.githubusercontent.com/metatypedev/ghjk/mod.ts";
import * as ghjk from "https://raw.githubusercontent.com/metatypedev/ghjk/mod.ts";
import * as ports from "https://raw.githubusercontent.com/metatypedev/ghjk/ports/mod.ts";

// top level `install`s go to the `main` env
ghjk.install(ports.protoc());
ghjk.install(ports.rust());

// the previous block is equivalent to
ghjk.env("main", {
  installs: [
    ports.protoc(),
    ports.rust(),
  ],
});

ghjk.env("dev", {
  // by default, all envs are additively based on `main`
  // pass false here to make env indiependent.
  base: false,
  // envs can specify standard env vars
  vars: { CARGO_TARGET_DIR: "my_target" },
  installs: [
    ports.cargobi({ crateName: "cargo-insta" }),
    ports.act(),
  ],
});

ghjk.env({
  name: "docker",
  desc: "for Dockerfile usage",
  // NOTE: env references are order-independent
  base: "ci",
  installs: [
    ports.cargobi({ crateName: "cargo-chef" }),
    ports.zstd(),
  ],
});

// builder syntax is also availaible
ghjk.env("ci")
  .var("CI", "1")
  .install(
    ports.opentofu_ghrel(),
  );

// each task describes it's own env as well
ghjk.task({
  name: "run",
  base: "dev",
  fn: () => console.log("online"),
});
```

Once you've configured your environments:

- `$ ghjk envs cook $name` to reify and install an environment.
- `$ ghjk envs activate $name` to switch to an environment.
- And **most** usefully, `$ ghjk sync $name` to cook and activate and
  environment.
- If no `$name` is provided, most of these commands will operate on the default
  or currently active default environment.

### Ports

TBD: this feature is in development.

### Tasks

TBD: this feature is still in development.

### Secure configs

Certain options are configured through the `secureConfig` object.

```ts
import { env, stdSecureConfig } from "https://.../ghjk/mod.ts";
import * as ports from "https://.../ports/mod.ts";

env("trueBase")
  .install(
    ports.act(),
    ports.pipi({ packageName: "ruff" }),
  );

env("test").vars({ DEBUG: 1 });

// `stdSecureConfig` is a quick way to make an up to spec `secureConfig`.
export const secureConfig = stdSecureConfig({
  defaultBaseEnv: "trueBase",
  defaultEnv: "test",
  // by default, nodejs, python and other runtime
  // ports are not allowed to be used
  // during the build process of other ports.
  // Disable this security measure here.
  // (More security features inbound!.)
  enableRuntimes: true,
});
```

## Development

```bash
cat install.sh | GHJK_INSTALLER_URL=$(pwd)/install.ts bash
```
