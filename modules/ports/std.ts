//! This plugin exports the list of standard plugins other
//! plugins are allowed to depend on.
import validators, { PortDep, RegisteredPort } from "./types.ts";
import { manifest as man_tar_aa } from "../../ports/tar.ts";
import { manifest as man_git_aa } from "../../ports/git.ts";
import { manifest as man_curl_aa } from "../../ports/curl.ts";
import { manifest as man_unzip_aa } from "../../ports/unzip.ts";
import { manifest as man_cbin_ghrel } from "../../ports/cargo-binstall.ts";
import { manifest as man_node_org } from "../../ports/node.ts";
import { manifest as man_pnpm_ghrel } from "../../ports/pnpm.ts";

const aaPorts: RegisteredPort[] = [
  man_tar_aa,
  man_git_aa,
  man_curl_aa,
  man_unzip_aa,
]
  .map((man) => ({
    ty: "ambientAccess",
    manifest: validators.ambientAccessPortManifest.parse(man),
  }));

const denoPlugs: RegisteredPort[] = [
  man_cbin_ghrel,
  man_node_org,
  man_pnpm_ghrel,
]
  .map((man) => ({
    ty: "denoWorker",
    manifest: validators.denoWorkerPortManifest.parse(man),
  }));

export const map = Object.freeze(
  new Map([
    ...aaPorts,
    ...denoPlugs,
  ].map((plug) => [plug.manifest.name, plug])),
);

export const tar_aa = Object.freeze({
  id: man_tar_aa.name,
} as PortDep);

export const git_aa = Object.freeze({
  id: man_git_aa.name,
} as PortDep);

export const curl_aa = Object.freeze({
  id: man_curl_aa.name,
} as PortDep);

export const unzip_aa = Object.freeze({
  id: man_unzip_aa.name,
} as PortDep);

export const cbin_ghrel = Object.freeze({
  id: man_cbin_ghrel.name,
} as PortDep);

export const node_org = Object.freeze({
  id: man_node_org.name,
} as PortDep);

export const pnpm_ghrel = Object.freeze({
  id: man_pnpm_ghrel.name,
} as PortDep);
