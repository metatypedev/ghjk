// @ts-nocheck: Deno based
export { sophon } from "ghjk";
import { file } from "ghjk";
// import * as ports from "ghjk/ports/mod.ts"; // template-import

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
