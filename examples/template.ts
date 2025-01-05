// @ts-nocheck: Deno based

export { sophon } from "../mod.ts"; // template-import
import { file } from "../mod.ts"; // template-import
// import * as ports from "../ports/mod.ts"; // template-import

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
