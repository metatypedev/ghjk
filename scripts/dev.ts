#!/bin/env -S deno run -A

//! Spawns the provided arguments within an environment
//! that contains a ghjk installation from the repo instead
//! of the gloabl ghjk installation

import { defaultInstallArgs, install } from "../install/mod.ts";
import { $ } from "../utils/mod.ts";

const devDir = $.path(
  import.meta.dirname!,
  // await Deno.makeTempDir({
  //   prefix: "ghjk_le2e_",
  // }),
).join("../.dev");

const ghjkShareDir = await devDir.join("ghjk").ensureDir();

await (await $.removeIfExists(devDir.join("ghjk.ts")))
  .symlinkTo(import.meta.resolve("../ghjk.ts"));

const env: Record<string, string> = {
  BASH_ENV: `${ghjkShareDir.toString()}/env.bash`,
  ZDOTDIR: ghjkShareDir.toString(),
  GHJK_SHARE_DIR: ghjkShareDir.toString(),
  PATH: `${ghjkShareDir.toString()}:${Deno.env.get("PATH")}`,
  HOME: devDir.toString(),
};

{
  const confHome = await ghjkShareDir.join(".config").ensureDir();
  const fishConfDir = await confHome.join("fish").ensureDir();
  await (await $.removeIfExists(fishConfDir.join("config.fish")))
    .symlinkTo(ghjkShareDir.join("env.fish").toString());
  env["XDG_CONFIG_HOME"] = confHome.toString();
}

// install ghjk
await install({
  ...defaultInstallArgs,
  skipExecInstall: false,
  ghjkExecInstallDir: ghjkShareDir.toString(),
  // share the system's deno cache
  ghjkDenoCacheDir: Deno.env.get("DENO_DIR") ??
    $.path(Deno.env.get("HOME")!).join(".cache", "deno").toString(),
  ghjkShareDir: ghjkShareDir.toString(),
  // don't modify system shell configs
  shellsToHook: [],
});

// await $`${ghjkShareDir.join("ghjk").toString()} print config`
//   .cwd(devDir.toString())
//   .clearEnv()
//   .env(env);
//
// await $`${ghjkShareDir.join("ghjk").toString()} envs cook`
//   .cwd(devDir.toString())
//   .clearEnv()
//   .env(env);

await $`${Deno.args}`.env(env);
