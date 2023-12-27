export { ghjk } from "./mod.ts";
import * as ghjk from "./mod.ts";
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
import ruff from "./ports/ruff.ts";
import whiz from "./ports/whiz.ts";
import cpython from "./ports/cpy_bs.ts";
import pipi from "./ports/pipi.ts";
import emscripten from "./ports/emscripten.ts";
import tree_sitter from "./ports/tree-sitter.ts";

// these are just for quick testing
ghjk.install(
  // node(),
  // wasmedge(),
  // pnpm(),
  // cargo_binstall(),
  // tree_sitter(),
  // wasm_tools(),
  // wasm_opt(),
  // cargo_insta(),
  // mold({
  //   replaceLd: true,
  // }),
  // asdf({
  // act(),
  //   pluginRepo: "https://github.com/asdf-community/asdf-cmake",
  //   installType: "version",
  // }),
  // ...pipi({ packageName: "pre-commit" }),
  // protoc(),
  // ruff(),
  // whiz(),
  ...jco(),
  // cpython(),
  emscripten(),
);

// these are used for developing ghjk
ghjk.install(
  // act(),
  // ...pipi({ packageName: "pre-commit" }),
);

export const secureConfig = ghjk.secureConfig({
  allowedPortDeps: [...ghjk.stdDeps({ enableRuntimes: true })],
});
