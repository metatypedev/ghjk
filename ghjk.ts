/*
import { run, rust } from "./src/ghjk.ts";

rust({
  version: "1.55.0",
});

rust({
  version: "nightly",
  name: "nrust",
});

await run();
*/

export { ghjk } from "./mod.ts";
import node from "./plugs/node.ts";

node({});
