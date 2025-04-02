//! This plugin exports the list of standard ports other
//! plugins are expected to depend on.

import { type PortDep, reduceAllowedDeps } from "./types.ts";
import * as man_tar_aa from "../../../ports/tar.ts";
import * as man_unzip_aa from "../../../ports/unzip.ts";
import * as man_zstd_aa from "../../../ports/zstd.ts";
import * as man_git_aa from "../../../ports/git.ts";
import * as man_curl_aa from "../../../ports/curl.ts";
import * as man_cbin_ghrel from "../../../ports/cargo-binstall.ts";
import * as man_node_org from "../../../ports/node.ts";
import * as man_asdf_plugin_git from "../../../ports/asdf_plugin_git.ts";
import * as man_cpy_bs_ghrel from "../../../ports/cpy_bs.ts";
import * as man_rustup_rustlang from "../../../ports/rustup.ts";
import * as man_rust_rustup from "../../../ports/rust.ts";

/**
 * The default set of allowed port deps.
 */
const defaultAllowedDeps = reduceAllowedDeps([
  // ambient ports
  man_tar_aa,
  man_git_aa,
  man_curl_aa,
  man_unzip_aa,
  man_zstd_aa,
  // denoFile ports
  man_rustup_rustlang,
  man_cbin_ghrel,
]
  .map((portMods) => portMods.default()));

export const map = Object.freeze(
  Object.fromEntries(
    defaultAllowedDeps.map((dep) => [dep.manifest.name, dep]),
  ),
);

export const tar_aa = Object.freeze({
  name: man_tar_aa.manifest.name,
} as PortDep);

export const zstd_aa = Object.freeze({
  name: man_zstd_aa.manifest.name,
} as PortDep);

export const unzip_aa = Object.freeze({
  name: man_unzip_aa.manifest.name,
} as PortDep);

export const git_aa = Object.freeze({
  name: man_git_aa.manifest.name,
} as PortDep);

export const curl_aa = Object.freeze({
  name: man_curl_aa.manifest.name,
} as PortDep);

export const rustup_rustlang = Object.freeze({
  name: man_rustup_rustlang.manifest.name,
} as PortDep);

export const rust_rustup = Object.freeze({
  name: man_rust_rustup.manifest.name,
} as PortDep);

export const cbin_ghrel = Object.freeze({
  name: man_cbin_ghrel.manifest.name,
} as PortDep);

export const node_org = Object.freeze({
  name: man_node_org.manifest.name,
} as PortDep);

export const cpy_bs_ghrel = Object.freeze({
  name: man_cpy_bs_ghrel.manifest.name,
} as PortDep);

export const asdf_plugin_git = Object.freeze({
  name: man_asdf_plugin_git.manifest.name,
} as PortDep);
