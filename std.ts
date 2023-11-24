//! This plugin exports the list of standard plugins other
//! plugins are allowed to depend on.
import { PlugDep, RegisteredPlug } from "./core/types.ts";
import validators from "./core/validators.ts";
import { manifest as man_tar_aa } from "./plugs/tar.ts";
import { manifest as man_git_aa } from "./plugs/git.ts";
import { manifest as man_cbin_ghrel } from "./plugs/cargo-binstall.ts";
import { manifest as man_node_org } from "./plugs/node.ts";
import { manifest as man_pnpm_ghrel } from "./plugs/pnpm.ts";

const aaPlugs: RegisteredPlug[] = [
  man_tar_aa,
  man_git_aa,
]
  .map((man) => ({
    ty: "ambientAccess",
    manifest: validators.ambientAccessPlugManifest.parse(man),
  }));

const denoPlugs: RegisteredPlug[] = [
  man_cbin_ghrel,
  man_node_org,
  man_pnpm_ghrel,
]
  .map((man) => ({
    ty: "denoWorker",
    manifest: validators.denoWorkerPlugManifest.parse(man),
  }));

export const map = Object.freeze(
  new Map([
    ...aaPlugs,
    ...denoPlugs,
  ].map((plug) => [plug.manifest.name, plug])),
);

export const tar_aa = Object.freeze({
  id: man_tar_aa.name,
} as PlugDep);

export const git_aa = Object.freeze({
  id: man_git_aa.name,
} as PlugDep);

export const cbin_ghrel = Object.freeze({
  id: man_cbin_ghrel.name,
} as PlugDep);

export const node_org = Object.freeze({
  id: man_node_org.name,
} as PlugDep);

export const pnpm_ghrel = Object.freeze({
  id: man_pnpm_ghrel.name,
} as PlugDep);
