//! The list of ports enabled when enableRuntimes is used on a ghjkfile configuration.

import * as cpy_bs from "../../../ports/cpy_bs.ts";
import * as node from "../../../ports/node.ts";
import * as rust from "../../../ports/rust.ts";
import * as asdf_plugin_git from "../../../ports/asdf_plugin_git.ts";

export default [
  // commonly used by the npmi port for installation using npm
  node.default(),
  // commonly used by the pipi port for installation using pip
  cpy_bs.default(),
  // commonly used by the cargobi port for building crates
  rust.default(),
  // used by the asdf port for installing asdf plugins
  asdf_plugin_git.buildDep(),
];
