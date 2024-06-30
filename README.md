# ghjk

ghjk /gk/ is a programmable runtime manager and an attempt at a successor for [asdf](https://github.com/asdf-vm/asdf).

> ghjk is part of the
> [Metatype ecosystem](https://github.com/metatypedev/metatype). Consider
> checking out how this component integrates with the whole ecosystem and browse
> the
> [documentation](https://metatype.dev?utm_source=github&utm_medium=readme&utm_campaign=ghjk)
> to see more examples.

## Introduction

ghjk offers a unified abstraction to manage package managers (e.g. cargo, pnpm, poetry), languages runtimes (e.g. nightly rust, node@18, python@latest) and developer tools (e.g. pre-commit, eslint, protoc). It enables you to define a consistent environment across your dev environments, CI/CD pipelines and containers keeping everything well-defined in your repo and providing a great DX.

ghjk was designed to be an intermediate alternative between [Earthly](https://github.com/earthly/earthly)/[Dagger](https://github.com/dagger/dagger) (lighter and more flexible) and complex building tools like [Bazel](https://github.com/bazelbuild/bazel/)/[Nix-based devenv](https://github.com/cachix/devenv) (simpler and more extensible). This makes it especially convenient for mono-repos and long-lived projects. See [Metatype](https://github.com/metatypedev/metatype) and its [ghjkfile](https://github.com/metatypedev/metatype/blob/main/ghjk.ts) for a real world example.

![](./ghjk.drawio.svg)

## Features

- Soft-reproducable developer environments.
- Install posix programs from different backend like npm, pypi, crates.io.
- Tasks written in typescript.
- Run tasks when entering/exiting envs.

## Getting started

```bash
# stable
curl -fsSL https://raw.githubusercontent.com/metatypedev/ghjk/0.2.0/install.sh | bash
# latest (main)
curl -fsSL https://raw.githubusercontent.com/metatypedev/ghjk/0.2.0/install.sh | GHJK_VERSION=main bash/fish/zsh
```

In your project, create a configuration file called `ghjk.ts` that look something like:

```ts
// NOTE: All the calls in your `ghjk.ts` file are ultimately modifying the 'sophon' proxy 
// object exported here.
// WARN: always import `hack.ts` file first
export { sophon } from "https://raw.githubusercontent.com/metatypedev/ghjk/0.2.0/hack.ts";
import {
  install, task,
} from "https://raw.githubusercontent.com/metatypedev/ghjk/0.2.0/hack.ts";
import node from "https://raw.githubusercontent.com/metatypedev/ghjk/0.2.0/ports/node.ts";

// install programs (ports) into your env
install(
  node({ version: "14.17.0" }),
);

// write simple scripts and execute them using
// `$ ghjk x greet`
task("greet", async ($, { argv: [name] }) => {
  await $`echo Hello ${name}!`;
});
```

Use the following command to then access your environment:

```bash
ghjk sync
```

### Environments

Ghjk is primarily configured through constructs called "environments" or "envs" for short. 
They serve as recipes for making (mostly) reproducable posix shells.

```ts
export { sophon } from "https://raw.githubusercontent.com/metatypedev/ghjk/0.2.0/hack.ts";
import * as ghjk from "https://raw.githubusercontent.com/metatypedev/ghjk/0.2.0/hack.ts";
import * as ports from "https://raw.githubusercontent.com/metatypedev/ghjk/0.2.0/ports/mod.ts";

// top level `install`s go to the `main` env
ghjk.install(ports.protoc());
ghjk.install(ports.rust());

// the previous block is equivalent to
ghjk.env("main", {
  installs: [ports.protoc(), ports.rust()],
});

ghjk
  .env("dev", {
    // by default, all envs are additively based on `main`
    // pass false here to make env independent.
    // or pass name(s) of another env to base on top of
    inherit: false,
    // envs can specify posix env vars
    vars: { CARGO_TARGET_DIR: "my_target" },
    installs: [
      ports.cargobi({ crateName: "cargo-insta" }),
      ports.act(),
    ],
  })
  // use env hooks to run code on activation/deactivation
  .onEnter(ghjk.task(($) => $`echo dev activated`))
  .onExit(ghjk.task(($) => $`echo dev de-activated`));

ghjk.env({
  name: "docker",
  desc: "for Dockerfile usage",
  // NOTE: env references are order-independent
  inherit: "ci",
  installs: [ports.cargobi({ crateName: "cargo-chef" }), ports.zstd()],
});

// builder syntax is also availaible
ghjk.env("ci").var("CI", "1").install(ports.opentofu_ghrel());

// each task describes it's own env as well
ghjk.task({
  name: "run",
  inherit: "dev",
  fn: () => console.log("online"),
});
```

Once you've configured your environments:

- `$ ghjk envs cook $name` to reify and install an environment.
- `$ ghjk envs activate $name` to switch to an environment.
- And **most** usefully, `$ ghjk sync $name` to cook and _then_ activate an
  environment.
  - If shell is already in the specified env, it only does cooking.
  - Make sure to `sync` or `cook` your envs after changes.
- If no `$name` is provided, most of these commands will operate on the default
  or currently active environment.

### Ports

TBD: this feature is in development. 
Look in the [kitchen sink](./examples/kitchen/ghjk.ts) for what's currently implemented.

### Tasks

TBD: this feature is still in development.
Look in the [tasks example](./examples/tasks/ghjk.ts) for what's currently implemented.

#### Anonymous tasks

Tasks that aren't give names cannot be invoked from the CLI. 
They can be useful for tasks that are meant to be common dependencies of other tasks.

### `hack.ts`

The imports from the `hack.ts` module, while nice and striaght forward to use, hold and modify global state.
Any malicious third-party module your ghjkfile imports will thus be able to access them as well, provided they import the same version of the module.

```ts
// evil.ts
import { env, task } from "https://.../ghjk/hack.ts";

env("trueBase").install(ports.act(), ports.pipi({ packageName: "ruff" }));

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

To prevent this scenario, the exports from `hack.ts` inspect the call stack and panic if they detect more than one module using them.
This means if you want to spread your ghjkfile across multiple modules, you'll need to use functions described below.

> [!CAUTION]
> The panic protections of `hack.ts` described above only work if the module is the first import in your ghjkfile.
> If a malicious script gets imported first, it might be able to modify global primordials and get around them.
> We have more ideas to explore on hardening Ghjk security.
> This _hack_ is only a temporary compromise while Ghjk is in alpha state.

The `hack.ts` file is only optional though and a more verbose but safe way exists through...

```ts
import { file } from "https://.../ghjk/mod.ts";

const ghjk = file({
  // items from `config()` are availaible here
  defaultEnv: "dev",

  // can even directly add installs, tasks and envs here
  installs: [],
});

// we still need this export for this file to be a valid ghjkfile
export const sophon = ghjk.sophon;

// the builder functions are also accessible here
const { install, env, task, config } = ghjk;
```

If you intend on using un-trusted third-party scripts in your ghjk, it's recommended you avoid `hack.ts`.

## Development

```bash
$ cat install.sh | GHJK_INSTALLER_URL=$(pwd)/install.ts bash/fish/zsh
```
