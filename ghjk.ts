export { ghjk } from "./mod.ts";
import node from "./ports/node.ts";
import pnpm from "./ports/pnpm.ts";
import cargo_binstall from "./ports/cargo-binstall.ts";
import wasmedge from "./ports/wasmedge.ts";
import wasm_tools from "./ports/wasm-tools.ts";
import wasm_opt from "./ports/wasm-opt.ts";
import cargo_insta from "./ports/cargo-insta.ts";
import jco from "./ports/jco.ts";
import mold from "./ports/mold.ts";
import act from "./ports/act.ts";
import asdf from "./ports/asdf.ts";
import protoc from "./ports/protoc.ts";
import earthly from "./ports/earthly.ts";
import ruff from "./ports/ruff.ts";
import whiz from "./ports/whiz.ts";

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
// asdf({
//   pluginRepo: "https://github.com/asdf-community/asdf-cmake",
//   installType: "version",
// });
// protoc({ });
// earthly({});
// ruff({});
// whiz({});
