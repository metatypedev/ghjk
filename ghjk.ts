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
import wasmedge from "./plugs/wasmedge.ts";
import wasm_tools from "./plugs/wasm-tools.ts";
import wasm_opt from "./plugs/wasm-opt.ts";
import cargo_insta from "./plugs/cargo-insta.ts";
import jco from "./plugs/jco.ts";
// import mold from "./plugs/mold.ts";
import act from "./plugs/act.ts";

// node({});
// wasmedge({});
// pnpm({});
// cargo_binstall({});
// wasm_tools({});
// wasm_opt({});
// cargo_insta({});
// jco({});
// mold({});
act({});
