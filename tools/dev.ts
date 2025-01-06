#!/bin/env -S deno run -A

//! Spawns the provided arguments within an environment
//! that contains a ghjk installation from the repo instead
//! of the gloabl ghjk installation

import { defaultInstallArgs, install } from "../src/install/mod.ts";
import { $ } from "../src/deno_utils/mod.ts";

const devDir = $.path(
  import.meta.dirname!,
  // await Deno.makeTempDir({
  //   prefix: "ghjk_le2e_",
  // }),
).join("../.dev");

const ghjkDataDir = await devDir.join("ghjk").ensureDir();

await (await $.removeIfExists(devDir.join("ghjk.ts")))
  .symlinkTo(import.meta.resolve("../ghjk.ts"));

const ghjkExePath = $.path(import.meta.resolve("../target/debug/ghjk"));
await ghjkDataDir
  .join("ghjk")
  .writeText(
    `#!/bin/sh
exec ${ghjkExePath.resolve().toString()} "$@"`,
    { mode: 0o700 },
  );

const env: Record<string, string> = {
  BASH_ENV: `${ghjkDataDir.toString()}/env.bash`,
  ZDOTDIR: ghjkDataDir.toString(),
  GHJK_DATA_DIR: ghjkDataDir.toString(),
  PATH: `${ghjkDataDir.toString()}:${Deno.env.get("PATH")}`,
  GHJK_CONFIG_DIR: devDir.toString(),
  // HOME: devDir.toString(),
};

await devDir.join("config.json").writeJsonPretty({
  "data_dir": ghjkDataDir.toString(),
});

// install ghjk
await install({
  ...defaultInstallArgs,
  ghjkDataDir: ghjkDataDir.toString(),
  // don't modify system shell configs
  shellsToHook: [],
});

// await $`${ghjkDataDir.join("ghjk").toString()} print serialized`
//   .cwd(devDir.toString())
//   .clearEnv()
//   .env(env);
//
// await $`${ghjkDataDir.join("ghjk").toString()} envs cook`
//   .cwd(devDir.toString())
//   .clearEnv()
//   .env(env);
let cmd;
if (Deno.args.length) {
  if (Deno.args[0] == "bash" && Deno.args.length == 1) {
    cmd = $`bash --rcfile ${env.BASH_ENV}`;
  } else if (Deno.args[0] == "fish" && Deno.args.length == 1) {
    // cmd = $`fish --no-config --init-command 'source ${
    cmd = $`fish --init-command 'source ${
      ghjkDataDir.join("env.fish").toString()
    }'`;
  } else {
    cmd = $`${Deno.args}`;
  }
} else {
  throw new Error("shell program arg expected");
}

await cmd.env(env).noThrow()
  .cwd(Deno.env.get("CWD") ?? Deno.cwd());
