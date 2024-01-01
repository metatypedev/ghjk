# Architecture

> [!WARNING] Ghjk is currently very early stages of development so expect
> unstable apis, large refactors and all kinds of insects and dragons if you
> intend to use it. A lot of the what's outlined in this document might change
> as the problem/design space is exploired.

## TLDR

> [!INFO] There's a overview diagram avail
> [here](https://www.tldraw.com/s/v2_c_MewHuw1lKwZzwv3XG8-Y6?viewport=-3756%2C-1126%2C10279%2C6280&page=page%3Apage).
> Be sure to update the [backup](./architecture.tldr) if you update that.

Ghjk is made up of a set of modules that each implement and encapsulate a set of
related features. The program is primarily consumed through the provided CLI. It
as an argument a path to a ghjkfile (through `$GHJK_CONFIG`) and if no such
argument is provided, it'll look for a file named `ghjk.ts` in the current or
any of the parent directories and treat it as the config file. It then loads the
config file in a `WebWorker` to obtain a config object which is expected to
contain configuration for any of the modules it's intersted in. The modules then
process their configuration and, based on it, outline the cli commands and flags
to expose through the CLI. The modules are also allowed to export entries to the
lockfile which is treated as a _memo_ of the processed config file. If As of
January 1, 2024 the following modules are imlemented/planned:

- Ports: download and install executables and libraries
- Envs (TBD): make CLI shell environments that have access to specific programs
  and variables
- Tasks: run commands in custom shell environments

## Run down

Ghjk is composed of two distinct spheres:

- The ghjkfile
  - Currently, only `ghjk.ts` files are supported
  - produces a config object that configure the different modules
- The host
  - loads and processes config files

Config files are the primary entry point for interacting with `ghjk` and provide
the vector of programmability for end users. As of today, only `ghjk.ts` config
files are supported but the `ghjk` is designed to support alternatives. You'll
observe that this kind of modularity and extensability will is a core motif of
the design, providing consraints, guidance and tension that's informed a lot of
the current design. A lot of decisions and abstractions will thus appear YAGNI
at this early stage but programmability is the name of the game in ghjk is
programmability so we prefer to err on the side of modularity.

### Ghjkfiles

### `ghjk.ts`

- They're loaded in a `WebWorker` (Deno flavoured) with access limited to:
  - `--allow-read=$PWD`
  - `--allow-net=*`
  - `--allow-env=*`
  - `--allow-sys=*`
- `ghjk.ts` is expected to expose a `getConfig` function
- `getConfig` is expected to return a `Promise<SerializedConfig>` type
  - If `ghjk.ts` exposes an item named `secureConfig`, it's passed as the first
    argument to `getConfig`.
- `ghjk/mod.ts` exposes a bunch of helpers for authoring conventional `ghjk.ts`
  but as far as the host is concerned, it's only aware of the `getConfig`
  interface.

#### `ghjk.lock.json`

- Will be searched for in the same directory as the ghjkfile.
- If found and if the `mtime` is after the config file's `mtime`, will be
  treated as valid.
- [ ] Move to non-json format
- [ ] Avoid discarding whole lockfile just because of `mtime`. Reuse what's
      possible.
- If no lockfile is found:
  - Each module declared in the config file processes its specific config and
    generates a lock entry
  - The lock entries are then used as input when driving the module
- If lockfile is found:
  - The lock entries of each module are used to drive the module.

### Host

The host is the section of the program expected to:

- Provide the `ghjk` CLI
- Load and serialize config files
- Load and drive the modules according CLI arguments and config object
- Lockfile management

### Modules

Ghjk is made up of a set of interacting modules implementing specific
functionality. Listed below are the modules that we think will make ghjk a
complete runtime manager but note that we don't currently plan on implementing
all of them. Getting each module to become competitive with equivalent tools let
alone achieving feature parity is beyond the resources available to the authors
today and their design is only considered here to provide a holistic framework
for development of ghjk. It's afterall a _programmable runtime manager_ and we
intend to make the core of ghjk (i.e. the host) modular enough that:

- Future implementations shouldn't require large refactors
- Easy intergration of external tools as modules
- Easy to swap implementation of modules without requring lot of changes in
  other dependent modules

#### Ports module

Equivalent tools:

- [`asdf`](https://github.com/asdf-vm/asdf)
- [`rtx`](https://github.com/jdx/rtx)
- [`proto`](https://moonrepo.dev/docs/proto)
- [`nix`](https://github.com/NixOS/nix) and especially so the
  [flakes](https://www.tweag.io/blog/2020-05-25-flakes/) feature.

- The ports module handles the download and installation of os level programs
  and libraries.
  - Executables, shared libraries, header files, documentation (TODO) are all in
    scope.
  - Installations are put in a centeral location and are shared across all the
    ghjk environments that make use of them.
- The config for the ports module expects:
  - `allowedPortDeps`: the list of ports other ports are allowed to depend on at
    build time.
    - Including the default `InstallConfig` to use for the dependency port if
      not specified by dependents.
  - `installs`: a list of `InstallConfig` objects describing the installations
    to provide.
    - Each `InstallConfig` will contain a `PortManifest` describing the `Port`
      program that will handle it's installation.
      - A `PortManifest` can optionally specify a list of other ports, under
        `buildDeps`, that the `Port` requires during build time.
        - A separate list of dependencies, `resolutionDeps`, is used for
          routines used for version resolution like `listAll` and
          `latestStable`.
      - Any dependencies used by ports must be declared in the top level
        `allowedPortDeps` list.
        - I.e. non standard dependencies will have to be manually declared there
          by users.
    - `InstallConfig` can optionally contain a `version`.
      - If found, the `version` is sanity checked agains the list of versions
        returned by `listAll`.
        - [ ] Fuzzy matching can optionally take place.
      - If not found, the `latestStable` version routine of the `Port` is
        invoked to obtain the version.
    - `InstallConfig` can optionally specify `InstallConfig`s to be used by the
      dependency ports.
      - If provided, will override the default from the top level
        `allowedPortDeps`.
    - [ ] runtime deps

##### Port implementation reference

- A Port is described through the `PortManifest` object.
- The implementation and execution of ports depends on the `ty` of the port but
  they're all roughly expose the following stages modeled after `asdf` plugins:
  - `listAll`: return a list of all the versions that the port
  - `latestStable`: the version to install when no version is specified by the
    user.
  - `download`: fetch distribution files into a provided dir
    - Any archives are preferrably extracted prior to placement in download dir
  - `install`: build, process, transform the downloaded files in any way
    required to create the final artifacts.
    - Artifacts are placed into the installDir
      - [ ] Consider hiding the final install directory from ports
  - `execEnv`: list of environment variables required by users of exposed
    artifacts
  - `listBinPaths`: list of executables to expose in the environment. Globs are
    expanded.
  - `listLibPaths`: list of shared libraries to expose in the environment. Globs
    are expanded.
  - `listIncludePaths`: list of header files to expose in the environment. Globs
    are expanded.
  - [ ] `listManPaths`: list of manual files to expose in the environment. Globs
        are expanded.

###### `denoWorker@v1` ports

- EcmaScript file at `moduleSpecifier` is `import`ed within a `WebWorker`.
  - It must export a `PortBase` class implementation under the name `Port`.
- Module will have limited deno permissions:
  - `-allow-run=execs-of-build-deps` on the `download` and `install` stages.
  - `-allow-run=execs-of-resolution-deps` on the `listAll` and `latestStable`
    stages.
  - `-allow-read=installDir,downloadDir` on all stages.

###### `ambientAccess@v1` ports

- Formally way of accessing tools already globally present on the system.
- Look at `AmbientAccessPortManifest` for what configuration is
  required/available.

#### Envs module

Reproducable CLI shell environments that can access specific tools and
variables. Including support to auto-load an environment when a specific shell
`cd`'s to the ghjk root.

Prior art:

- [`direnv`](https://www.jetpack.io/devbox)
- [`devenv`](https://devenv.sh)
- [`devbox`](https://www.jetpack.io/devbox)
- [`devshell`](https://github.com/numtide/devshell)

#### Tasks module

Task runner.

Inspiration:

- [`just`](https://github.com/casey/just)
- [`moon`](https://moonrepo.dev/moon/)

#### Build module

Build system. This one is not on the cards right now.

Aspirations:

- [`make`](https://en.wikipedia.org/wiki/Make_(software))
- [`bazel`](https://bazel.build/)
- [`nx`](https://nx.dev/)
- [`buck2`](https://buck2.build/)

#### Containers module

Create OCI compatible containers from based on the results of the Envs and Build
module. Not planned.

Looking at:

- [`earthly`](https://earthly.dev)

#### Services module

Service orchestration.

Thinking of:

- [`docker compose`](https://docs.docker.com/compose/)
