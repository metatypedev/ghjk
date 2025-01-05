export { sophon } from "../../hack.ts";
import { config, env, install, task } from "../../hack.ts";
import * as ports from "../../ports/mod.ts";

config({
  // we can change which environment
  // is activated by default for example
  // when we enter the directory
  defaultEnv: "main",
  // set the env all others envs will by
  // default inherit from
  defaultBaseEnv: "main",
});

env("test", {
  installs: [ports.unzip()],
});

env("ci")
  .install(ports.opentofu_ghrel());

// top level `install` calls just
// go to an enviroment called "main"
install(ports.protoc());

// we can modify "main" directly
env("main")
  // hooks execute when environments are
  // activated/deactivated in interactive shells
  .onEnter(task(($) => $`echo enter`))
  .onExit(task(($) => $`echo exit`));
