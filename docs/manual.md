# User Manual

Ghjk is a toolkit for declarative and programmatic configuration of POSIX runtime environments.
Currently in heavy development, it features working implementations of:
- Tool installation and management
- Task runner
- Declarative and dynamic environment variables

This user manual is designed to be read on the Github web app within the repo that hosts the ghjk codebase.
<!-- If moving away from github, make sure to adjust the outgoing links -->

## Installation

Before anything, the ghjk CLI should be installed.
There are installer scripts available in the repo.


```bash
# stable
curl -fsSL "https://raw.githubusercontent.com/metatypedev/ghjk/v0.3.1-rc.2/install.sh" | bash
```

This will install the CLI and add some hooks to your shell rc configurations that ghjk needs to function.
Installation can be customized through a number of environment variables that can be found [here](./installation-vars.md).

## `ghjk.ts`

Ghjk is configured through a ghjkfile.
Currently, a typescript based ghjkfile is available and this is what the rest of this document will use.
You can use the following command to create a starter `ghjk.ts` file in the current directory:

```bash
# initialize a `ghjk.ts` file
ghjk init ts
```

Look through the following snippet to understand the basic structure of a `ghjk.ts` file.

```ts
// all ghjk.ts files are expected to export this special `sophon` object
export { sophon } from "@ghjk/ts";
// the import sources, like `@ghjk/ts`, is provided by default through a
// a `deno.jsonc` file created in the `.ghjk/` directory
import { file } from "@ghjk/ts";
// import the port for the node program
import node from "@ghjk/ports_wip/node.ts";

// Create the ghjk object using the `file` function. This modifies 
// the sophon exported above and *MAY* only be called *ONCE* during 
// serialization.
const ghjk = file();

// install programs (ports) into your env
ghjk.install(
  node({ version: "14.17.0" }),
);

// declare tasks to be available from the command line.
ghjk.task("greet", async ($) => {
  await $`echo Hello ${$.argv}!`;
});
```

One can look at the [examples](../examples/) found in the ghjk repo for an exploration of the different features available.

## `$GHJKDIR`

Once you have a ghjkfile ready to go, the ghjk CLI can be used to access most of the features your ghjkfile is using.
Augmenting the CLI are hooks that were installed into your shells rc file (startup scripts like `~/.bashrc`). 
These hooks check and modify your shell environment when you create a new one or `cd` (change directory) into a ghjk relevant directory.

What constitutes a ghjk relevant directory?
- One that contains a recognized ghjkfile format like any file called `ghjk.ts`
- One that contains a `.ghjk` directory

Note that if any parent directory contains these files, the current directory is considered part of that ghjk context.
The `$GHJKFILE` environment variable can be set to point the CLI and hooks at a different ghjkfile.

The `.ghjk` dir is used by ghjk for different needs and contains some files you'll want to check into version control.
It includes its own `.gitignore` file by default that excludes all items not of interest for version control.
The `$GHJKDIR` variable can be used to point the CLI at a different directory.

## Serialized

The ghjk CLI loads your typescript file in a worker to get at the actual configuration.
This process is called _serialization_. 
The CLI generally operates on the output of this serialization though it might need to load your ghjkfile in a worker again, to execute task functions you've written for example.
While the details of the output are not important, this _serialize then do_ workflow defines how ghjk functions as we should see.

The ghjk CLI serializes any discovered ghjkfile immediately when invoked.
In fact, what commands are available on the CLI are determined by the outputs of serialization.
If you declared tasks for example, ghjk will add the `tasks` sections to invoke them.

To look at what the ghjkfile looks like serialized, you can use the following command:

```bash
# look at the serialized form the ghjkfile
ghjk print serialized
```

#### The Hashfile

Loading up typescript files in workers is not the quickest of operations as it turns out.
Ghjk caches output of this serialization to improve the latency of the CLI commands.
This raises the question how well the cache invalidation works in ghjk and that's a good question. 
Cache invalidation is one of the hardest problems in computer science according to lore.

Thankfully, through the great sandbox provided through Deno's implementation, the cache is invalidated when the following items change: 
- The contents of the ghjkfile
- Files accessed during serialization
- Environment variables read during serialization
- Configuration used by the ghjk cli

This doesn't cover everything though, and the `ghjk.ts` implementation generally assumes a declarative paradigm of programming. 
You'll generally want to avoid any conditional logic that's not deterministic and depends on inputs like time or RNGs.
If you encounter any edge cases or want to force re-serialization, you can remove the hashfile at `.ghjk/hash.json` which contains hashes for change tracking.

```bash
# remove the hashfile to force re-serialization
$ rm .ghjk/hash.json
$ ghjk --help
```

<!--TODO: #66 provide `fetch` shim that caches -->

#### The Lockfile

The cached value of the serialization results are stored in the lockfile.
The lockfile is what the different systems of ghjk use to store transient information that needs to be tracked across serializations.
Currently, this is mainly used by the ports system to retain version numbers resolved during installation, which is important for the basic need of reproducibility.

To maintain reproducibility across different machines, this file needs to be checked into version control.
Unfortunately, this can lead to version conflicts during git merges for example.

One can always remove the `.ghjk/lock.json` to remove the lockfile and recreate it.
But this can not only lead to loss of information, it can take a long time since the ports module must query different package registries to resolve versions and more.

The best way to resolve ghjk merge conflicts is to:
- Resolve any conflicts in the ghjkfile traditionally
- For conflicts in the lockfile, instead of manually resolving each conflict, just pick one version entirely
  - In the git CLI, easier to remove any incoming changes and revert to the base/HEAD branch
- Re-serialize by invoking the ghjk CLI to ensure the lockfile is up to date

These simple steps make sure that the _lockfile_ reflect what's in the latest _ghjkfile_ without needing to re-resolve the world.
Of course, if the discarded patches of the lockfile contained new port version specs, they'll be re-resolved possibly to a different version.
But generally, if the versions specified in ghjkfile are tight enough, it'll resolve the same values as before.
If versions are important, it's good to explicitly specify them in your ghjkfile.

The lockfile format itself is still in flux and there are plans to improve the merge conflict experience going forward.

## Tasks

Tasks are pretty simple to use.
You declare them in your ghjkfile, using typescript functions, and then invoke them from the the CLI.
The CLI will then load your ghjkfile in a worker and execute your function.

```ts
export { sophon } from "@ghjk/ts";
import { file } from "@ghjk/ts";

const ghjk = file();

ghjk.task("greet", async ($) => {
  await $`echo Hello ${$.argv}!`;
});
```

```bash
# list the available tasks
$ ghjk tasks

# x is an alias for tasks
$ ghjk x

# invoke the greet task
$ ghjk x greet ghjk
```

The `$` object is a enhanced version of the one from the [dax](https://jsr.io/david/jsr) library.
Amongst many things, it allows easy execution of shell commands in a cross platform way.
Look at the official documentation for all of it's illustrious powers.

Tasks can also depend on each other meaning that the depended on task is always executed first.
Any arguments to the tasks are also passed on the `$` object or the second parameter object.
Look at the [tasks example](../examples/tasks/ghjk.ts) for more details..

## Envs

Ghjk's environments, simply put, are a set of configurations for a POSIX environment. 
POSIX environments are primarily defined by the current working directory and the set environment variables.
Ghjk envs then allow you: 
- Set environment variables of course
- Add existing paths or newly installed program (ports) to the special `$PATH` variables
- Execute logic on entering and exiting envs
- Do all of this declaratively and in a composable manner

Let's look at how one configures an environment using the `ghjk.ts` file:

```ts
export { sophon } from "@ghjk/ts";
import { file } from "@ghjk/ts";

const ghjk = file();

ghjk.env("my-env")
  .var("MY_VAR", "hello POSIX!")
  // we can return strings from typescript functions for dynamic
  // variables
  .var("MY_VAR_DYN", () => `Entered at ${new Date().toJSON()}`)
  .onEnter(task(($) => console.log(`entering my-env`)))
  .onExit(task(($) => console.log(`entering my-env`)))
  ;
```

By default, your ghjkfile has an env called `main`.
Envs can inherit from each other and by default inherit from the `main` environment.
Inheritance is additive on most env properties and allows easy composition.
Please look at the [envs example](../examples/envs/ghjk.ts) or the [kitchen sink](../examples/kitchen/ghjk.ts) example which show all the knobs available on envs.

You can then access the envs feature under the `envs` section of the CLI:

```bash
# look at avail sub commands
$ ghjk envs
# alias for envs
$ ghjk e
# list available envs
$ ghjk envs ls
```

Before we can _activate_ an environment, it needs to be _cooked_. 
That is, entering an environment is a two step process.

Cooking is what we call preparing the environment.
Required programs for the env are resolved and installed.
The shims for these programs are prepared.
The shell scripts to activate/deactivate it are prepared.
The results of env cooking are stored inside the `.ghjk/envs` directory.

```bash
# cook a named env
$ ghjk e cook my-env
```

Once an environment is _cooked_, _activation_ is simple enough.
The name of the currently active environment is set to the `$GHJK_ENV` environment variable.

```bash
# activate using the CLI
$ ghjk e activate my-env
$ echo $GHJK_ENV
# my-env
$ echo $MY_VAR
# hello POSIX!
```

When an env is activated in a shell session, the `ghjk_deactivate` command will be made available for deactivation.
This will remove the set variables and restore old ones if any were overwritten.
The ghjk shell hooks auto-deactivate any active environments from you shell, when it `cd`s away into a directory that's not part of the context.

```bash
$ ghjk_deactivate
$ echo $MY_VAR
# <empty>
```

Note that the CLI activate command depends on the the ghjk shell hooks being available.
If not in an interactive shell, look at the CI section of this document for what options are available.

#### `sync`

The _cook_ and _activate_ process is common enough that there's a command available that does both, `sync`.
The `sync` command and both the `cook` and `activate` commands will operate on the currently active env if no env name argument is provided.
If no value is found at `$GHJK_ENV`, they'll use the set default env as described in the next section.

```bash
# cook and activate an environment
$ ghjk sync my-env
```

### Default Env

By default, the `main` environment is the one that's activated whenever you `cd` into the ghjk context.
You can change which env is activated by default using the `defaultEnv` setting.

```bash
ghjk.config({
  defaultEnv: "my-env",
});
```

`main` also serves as the default base all other envs inherit from.
The `defaultBaseEnv` parameter can be used to change this.

```bash
ghjk.config({
  defaultBaseEnv: "main",
});
```

## Ports

Ports are small programs that ghjk executes to download and install programs.
When the env that includes a port installation is activated, a path to shims of the programs will be added to the special `$PATH` env variables.
This extends to modifying the appropriate `$PATH` variables for libraries or any environment variables needed for the program to function.
Currently, ports that are written in Deno flavoured typescript are supported and there's a small collection of such programs provided in the ghjk repository.

The modules that implement port programs are also expected to expose a `conf` function as their default export.
The `conf` functions prove as a point of configuration for the port installation.
They return `InstallConfig` objects that describe user configuration along with where the port can be found and how to use it.
Any `InstallConfig` objects included in an env will then be resolved and installed when it's cooked.

```ts
// the default export corresponds to the `conf` function
import node from "@ghjk/ports_wip/node.ts";
// the npmi installs executable packages from npm
import npmi from "@ghjk/ports_wip/node.ts";

// top level `install` calls go to the `main` env
ghjk.install(
  // configure installation for the node port
  node({ version: "1.2.3" }),
  // configure npmi to install the eslint package
  npmi({ packageName: "eslint", version: "9" })
);
```

We can then `sync` the main env to install and access the programs.

```bash
# cook and activate
$ ghjk sync main
# the programs provided by the ports should now be available
$ node --version
$ eslint --version
```

### `buildDeps`

While the Deno standard library and ESM url imports allow ports to do a lot, some ports require other programs to succeed at their tasks. 
For example, the `npmi` port, which installs executable packages from npm, relies on the `npm` program for the actual functionality.
This is achieved by allowing ports to depend on other ports that they can use for tasks such as resolving available versions, downloading appropriate files, archive extraction, compilation...etc.

As a soft security measure, ports are restricted to what other port they're allowed to depend on.
The default set includes common utilities like `curl`, `git`, `tar` and others which are used by most ports.
More ports can be easily added to the allowed port dep set.

```ts
import { file } from "@ghjk/ts";
// barrel export for ports in the ghjk repo
import * as ports from "@ghjk/ports_wip";

const ghjk = file();

ghjk.install(
  ports.npmi({ packageName: "tsx" })
)

ghjk.config({
  allowedBuildDeps: [
    ports.node(),
  ],
});
```

The standard set of allowed port deps can be found [here](../modules/ports/std.ts).

#### `enableRuntimes`

The default set excludes scripting runtimes like `python` and `node` as another soft security measure.
Commonly used ports like `npmi`, `pipi` and `cargobi` rely on such ports to build and install programs from popular registries.
The `enableRuntimes` toggle can be used to add these common dependencies to the allowed build set.

```ts
ghjk.config({
  enableRuntimes: true,
});
```

One can look at the list of ports included by the flag [here](../modules/ports/std_runtime.ts)

#### Ambient ports

Ambient ports reuse programs already available on the system instead of downloading and installing one from the internet.
For a variety of reasons, the standard set of allowed port deps includes a number of these.
Please install the following programs first before attempting to use ghjk ports:

- git
- tar (preferably GNU tar)
- curl
- unzip
- zstd

### Writing ports

The ports implementations is going through a lot of breaking changes.
If you need to author a new port right away, please look at the available implementations.

## CI

While the ghjk CLI and hooks are primarily designed for interactive shells in mind, they also support non-interactive use cases like scripts for CI jobs and for use in build tools.
The primarily difference between the two scenarios is how activation of envs is achieved as we shall see below.

### Installation

The standard installation script is the best way to install ghjk in CI environments.
The environment [variables](./installation-vars.md) used for the installer customization come in extra handy here.
Namely, it's good practice to:
- Make sure the `$VERSION` is the one used by the ghjkfile.
- Specify `$GHJK_DATA_DIR` to a location that can be cached by your CI tooling. This is where ports get installed.
- Specify `$GHJK_INSTALL_EXE_DIR` to a location that you know will be in `$PATH`. This is where the ghjk CLI gets installed to.

```dockerfile
# sample of how one would install ghjk for use in a Dockerfile
ARG GHJK_VERSION=v0.3.1-rc.2
# /usr/bin is available in $PATH by default making ghjk immediately avail
RUN curl -fsSL "https://raw.githubusercontent.com/metatypedev/ghjk/${GHJK_VERSION}/install.sh" \
    | GHJK_INSTALL_EXE_DIR=/usr/bin sh
```

### Activation

When working on non-interactive shells, the ghjk shell hooks are not available.
This means that the default environment won't be activated for that CWD, nor will any changes occur on changing directories.
It also prevents the `ghjk sync` and `ghjk envs activate` commands from functioning which requires that these hooks be run before each command.
In such scenarios, one can directly `source` the activation script for the target env from the `.ghjk` directory.

```bash
# cooking must be done to make the activations scripts available
ghjk cook my-env
# there are scripts for POSIX and fish shells
# dot command is the preferred alias of `source` since it's the 
# only one supported by POSIX sh
. .ghjk/envs/my-env/activate.sh
echo $GHJK_ENV
# my-env
echo $MY_VAR
# hello POSIX!
```

Make sure to activate the environment for every shell session in your CI scripts.
In a Dockerfile, which use POSIX sh, we'll need to:

```dockerfile
# set GHJK_ENV for use
ENV GHJK_ENV=ci
ENV GHJK_ACTIVATE=.ghjk/envs/$GHJK_ENV/activate.sh
# cook $GHJK_ENV
RUN ghjk envs cook

# each RUN command is a separate shell session
# and requires explicit activation
RUN . "$GHJK_ACTIVATE" \
    && echo $MY_VAR
```

This extra boilerplate can be avoided by using the following `SHELL` command, available in some Dockerfile implementations, or by using command processors more advanced that POSIX `sh` like `bash`, `zsh` or `fish`.

```dockerfile
# contraption to make sh load the activate script at startup
SHELL ["/bin/sh", "-c", ". .ghjk/envs/my-env/activate.sh; sh -c \"$*\"", "sh"]
RUN echo $MY_VAR
```

### Github action

For users of Github CI, there's an action available on the [marketplace](https://github.com/marketplace/actions/ghjk-everything) that is able to:
- Installs ghjk CLI and hooks
- Caches the ghjk share directory
- Cooks the `$GHJK_ENV` or default environment

Note that the default shell used by github workflows is POSIX `sh`.
It's necessary to switch over to the `bash` shell to have the hooks auto activate your environment.
Otherwise, it's necessary to use the approach described in the section above.

```yaml
  my-job:
    steps:
      - uses: metatypedev/setup-ghjk@v1
      - shell: bash # must use bash shell for auto activation
        run: |
          echo $GHJK_ENV
```

## `config.json`

One can examine the configuration values used by the CLI using the following command...

```bash
ghjk print config
# {
#   /* json rep of config */
# }
```

These are generally values that need to be resolved before the serializaiton process.
Most of these settings can be configured through the `config.json` file, which is looked for at `.ghjk/config.json` by default.
Additionally, most of these values can be configured through environment variables under keys that are the name of the config value prefixed by `GHJK_`.
So for the `repo_root` config, this would be resolved from the `$GHJK_REPO_ROOT` env var.
Some of the values can be configured globally thorugh a file looked for at `$XDG_CONFIG_PATH/ghjk/config.json`.

The following snippet shows the current config set, their defafults, and an explanation of their purpose.

```jsonc
{
  // Path to the deno config file used to configure the deno runtime
  // like import aliases. 
  // If not found, this is created by default to support the `ghjk` 
  // alias used by ghjk.ts files. Default creation is disabled if
  // the import_map path is set.
  "deno_json": "<$ghjkdir/deno.jsonc>",
  // Path to an deno.lock file used to lock modules imported by deno.
  // Set it to value `off` to disable lockfile usage.
  // The `deno.json` spec also supports configuring the deno.lock path 
  // from within it which will be respected
  "deno_lockfile": "<$ghjkdir/deno.lock>",
  // Path to an import_map.json for resolving js import aliases
  // `deno_json`, if set, will takes precedence over this. 
  // The `deno.json` spec also supports configuring the import_map path 
  // from within it which will be respected
  "import_map": null,

  // data dir to be used by systems. This is where
  // ports get installed and is shared across ghjkdirs.
  // *supports global configuration*
  "data_dir": "<$XDG_DATA_DIR/ghjk>",
  // Cache dir used by deno. This is where
  // where deno caches downloaded modules.
  // *supports global configuration*
  "deno_dir": "<$XDG_DATA_DIR/ghjk/deno>",
  // The repo root url used to import the typescript section
  // of the ghjk implementation from.
  // *supports global configuration*
  "repo_root": "<url to ghjk git repo under the ref used to build the current cli>",
}
```

In addition to a `config.json` files, `config.json5` files are also supported which is a [friendlier superset of JSON](https://json5.org/) with support for comments and more.
Note that environment varible resolved config takes precedence over the local `config.json` which takes precedence over globally configured values.
