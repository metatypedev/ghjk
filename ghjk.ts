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
import install from "./plugs/wasmedge.ts";
import pnpm from "./plugs/pnpm.ts";
import cargo_binstall from "./plugs/cargo-binstall.ts";
import wasm_tools from "./plugs/wasm-tools.ts";

// node({});
// wasmedge({});
// pnpm({});
// cargo_binstall({});
wasm_tools({});
