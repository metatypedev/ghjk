export { sophon } from "@ghjk/ts";
import { file } from "@ghjk/ts";
// import * as ports from "@ghjk/ports_wip"; // template-import

// This export is necessary for typescript ghjkfiles
const ghjk = file({
  // allows usage of ports that depend on node/python
  // enableRuntimes: true,
});

ghjk.install(
  // install ports into the main env
  // ports.node(),
  // ports.pnpm(),
);

ghjk.task("greet", async ($) => {
  await $`echo Hello ${$.argv}`;
});
