//! This plugin exports the list of standard ports other
//! plugins are allowed to depend on.
import validators, {
  type AllowedPortDepX,
  type PortDep,
  type PortManifest,
} from "./types.ts";
import { manifest as man_tar_aa } from "../../ports/tar.ts";
import { manifest as man_unzip_aa } from "../../ports/unzip.ts";
import { manifest as man_zstd_aa } from "../../ports/zstd.ts";
import { manifest as man_git_aa } from "../../ports/git.ts";
import { manifest as man_curl_aa } from "../../ports/curl.ts";
import { manifest as man_cbin_ghrel } from "../../ports/cargo-binstall.ts";
import { manifest as man_node_org } from "../../ports/node.ts";
import { manifest as man_pnpm_ghrel } from "../../ports/pnpm.ts";
import { manifest as man_asdf_plugin_git } from "../../ports/asdf_plugin_git.ts";
import { manifest as man_cpy_bs_ghrel } from "../../ports/cpy_bs.ts";
import { getPortRef } from "../../utils/mod.ts";

const aaPorts: PortManifest[] = [
  man_tar_aa,
  man_git_aa,
  man_curl_aa,
  man_unzip_aa,
  man_zstd_aa,
];

const denoPorts: PortManifest[] = [
  man_cbin_ghrel,
  man_pnpm_ghrel,
  man_asdf_plugin_git,
  // man_cpy_bs_ghrel,
  // man_node_org,
];

const defaultAllowedDeps: AllowedPortDepX[] = [
  ...aaPorts,
  ...denoPorts,
]
  .map((manifest) => ({
    manifest,
    defaultInst: {
      portRef: getPortRef(manifest),
    },
  }))
  .map((portDep) => validators.allowedPortDep.parse(portDep));

export const map = Object.freeze(
  Object.fromEntries(
    defaultAllowedDeps.map((dep) => [dep.manifest.name, dep]),
  ),
);

export const tar_aa = Object.freeze({
  name: man_tar_aa.name,
} as PortDep);

export const zstd_aa = Object.freeze({
  name: man_zstd_aa.name,
} as PortDep);

export const unzip_aa = Object.freeze({
  name: man_unzip_aa.name,
} as PortDep);

export const git_aa = Object.freeze({
  name: man_git_aa.name,
} as PortDep);

export const curl_aa = Object.freeze({
  name: man_curl_aa.name,
} as PortDep);

export const cbin_ghrel = Object.freeze({
  name: man_cbin_ghrel.name,
} as PortDep);

export const node_org = Object.freeze({
  name: man_node_org.name,
} as PortDep);

export const pnpm_ghrel = Object.freeze({
  name: man_pnpm_ghrel.name,
} as PortDep);

export const cpy_bs_ghrel = Object.freeze({
  name: man_cpy_bs_ghrel.name,
} as PortDep);

export const asdf_plugin_git = Object.freeze({
  name: man_asdf_plugin_git.name,
} as PortDep);
