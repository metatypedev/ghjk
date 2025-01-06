export { sophon } from "ghjk/hack.ts";
import { file } from "ghjk/hack.ts";

const ghjk = file({
  defaultEnv: "empty",
  envs: [{ name: "empty", inherit: false }],
  defaultBaseEnv: "empty",
  allowedBuildDeps: [],
  installs: [],
  stdDeps: true,
  enableRuntimes: true,
  tasks: {},
});

const { env, task } = ghjk;

env("main")
  .var("A", "A#STATIC")
  .var("B", () => "B#DYNAMIC")
  .var("C", ($) => $`echo C [$A, $B]`.text())
  .onEnter(task(($) => $`echo enter $A, $B, $C`));
