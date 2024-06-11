import { stdDeps } from "../../files/mod.ts";
import { file } from "../../mod.ts";
import * as ports from "../../ports/mod.ts";

const ghjk = file({
  // configre an empty env so that no ports are avail by default in our workdir
  defaultEnv: "empty",
  envs: [{ name: "empty", inherit: false }],
  // we wan't all other envs to start from empty unless they opt otherwise
  defaultBaseEnv: "empty",

  // we won't use the following for now
  // but they pretty much configure the "main" env
  allowedBuildDeps: [],
  installs: [],
  stdDeps: true,
  enableRuntimes: true,
  // tasks aren't attached to envs
  // but have their own env
  tasks: [],
});

// we need this export for this file to be a valid ghjkfile
// it's the one thing used by the ghjk host implementation to
// interact with your ghjkfile
export const sophon = ghjk.sophon;

const { install, env, task } = ghjk;

// we can configure main like this as well
env("main")
  // provision env vars to be acccessbile in the env
  .var("RUST_LOG", "info,actix=warn")
  // provision programs to be avail in the env
  .install(ports.jq_ghrel())
  .allowedBuildDeps(
    // ports can use the following installs at build time
    // very WIP mechanism but this is meant to prevent ports from
    // pulling whatever dependency they want at build time unless
    // explicityl allowed to do so
    ports.node({}),
    ports.rust({ version: "stable" }),
    // add the std deps including the runtime ports.
    // These includes node and python but still, precedence is given
    // to our configuration of those ports above
    ...stdDeps({ enableRuntimes: true }),
  );

// these top level installs go to the main env as well
install(
  // ports can declare their own config params
  ports.rust({
    version: "stable",
    profile: "minimal",
    components: ["rustfmt"],
  }),
  // some ports use other programs as backends
  ports.pipi({ packageName: "pre-commit" })[0],
  ports.cargobi({ crateName: "mise" }),
);

const ci = env("ci", {
  // this inherits from main so it gets protoc and curl
  inherit: "main",
  // extra installs
  installs: [ports.jq_ghrel()],
  // it has extra allowed deps
  allowedBuildDeps: [ports.node()],
  // more env vars
  vars: {
    CI: 1,
  },
  desc: "do ci stuff",
});

// tasks are invocable from the cli
task("install-app", ($) => $`cargo fetch`);

task("build-app", {
  dependsOn: "install-app",
  // the task's env inherits from ci
  inherit: ci.name,
  // it can add more items to that env
  installs: [],
  // vars
  vars: {
    RUST_BACKTRACE: 1,
  },
  // allowed build deps
  allowedBuildDeps: [ports.zstd()],
  desc: "build the app",
  fn: async ($) => {
    await $`cargo build -p app`;
    // we can access tar here from the ci env
    await $`tar xcv ./target/debug/app -o app.tar.gz`;
  },
});

env("python")
  // all envs will inherit from `defaultBaseEnv`
  // unles set to false which ensures true isolation
  .inherit(false)
  .install(
    ports.cpy_bs({ version: "3.8.18", releaseTag: "20240224" }),
  )
  .allowedBuildDeps(
    ports.cpy_bs({ version: "3.8.18", releaseTag: "20240224" }),
  );

env("dev")
  // we can inherit from many envs
  // if conflict on variables or build deps, the one declared
  // later overrides
  .inherit(["main", "python"])
  // we can set tasks to run on activation/decativation
  // which are inheritable
  .onEnter(task(($) => $`echo enter`))
  .onEnter(task({
    workingDir: "..",
    fn: ($) => $`ls`,
  }));
