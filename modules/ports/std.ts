//! This plugin exports the list of standard ports other
//! plugins are allowed to depend on.
import validators, {
  type AllowedPortDep,
  type PortDep,
  type PortManifest,
} from "./types.ts";
import { manifest as man_tar_aa } from "../../ports/tar.ts";
import { manifest as man_git_aa } from "../../ports/git.ts";
import { manifest as man_curl_aa } from "../../ports/curl.ts";
import { manifest as man_unzip_aa } from "../../ports/unzip.ts";
import { manifest as man_cbin_ghrel } from "../../ports/cargo-binstall.ts";
import { manifest as man_node_org } from "../../ports/node.ts";
import { manifest as man_pnpm_ghrel } from "../../ports/pnpm.ts";

const aaPorts: PortManifest[] = [
  man_tar_aa,
  man_git_aa,
  man_curl_aa,
  man_unzip_aa,
];

const denoPorts: PortManifest[] = [
  man_cbin_ghrel,
  man_node_org,
  man_pnpm_ghrel,
];

const allowedDeps: AllowedPortDep[] = [
  ...aaPorts,
  ...denoPorts,
]
  .map((man) => validators.portManifest.parse(man))
  .map((manifest) => ({
    manifest,
    defaultInst: {
      portName: manifest.name,
    },
  }));

export const map = Object.freeze(
  Object.fromEntries(
    allowedDeps.map((dep) => [dep.manifest.name, dep]),
  ),
);

export const tar_aa = Object.freeze({
  name: man_tar_aa.name,
} as PortDep);

export const git_aa = Object.freeze({
  name: man_git_aa.name,
} as PortDep);

export const curl_aa = Object.freeze({
  name: man_curl_aa.name,
} as PortDep);

export const unzip_aa = Object.freeze({
  name: man_unzip_aa.name,
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
