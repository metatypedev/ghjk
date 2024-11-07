// @ts-nocheck: Deno based

import { file } from "../../mod.ts"; // template-import
// import * as ports from "../../ports/mod.ts"; // template-import

const ghjk = file({
  // allows usage of ports that depend on node/python
  // enableRuntimes: true,
});

// This export is necessary for ts ghjkfiles
export const sophon = ghjk.sophon;

ghjk.install(
  // install ports into the main env
  // ports.node(),
  // ports.cpy_bs(),
);

ghjk.task("greet", async ($) => {
  await $`echo Hello ${$.argv}`;
});
