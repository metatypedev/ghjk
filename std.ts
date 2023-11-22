//! This plugin exports the list of standard plugins other
//! plugins are allowed to depend on.
import { PlugDep, RegisteredPlug } from "./core/types.ts";
import validators from "./core/validators.ts";
import { manifest as man_tar_aa } from "./plugs/tar.ts";
import { manifest as man_git_aa } from "./plugs/git.ts";

const aaPlugs: RegisteredPlug[] = [
  man_tar_aa,
  man_git_aa,
]
  .map((man) => ({
    ty: "ambientAccess",
    manifest: validators.ambientAccessPlugManifest.parse(man),
  }));

const denoPlugs: RegisteredPlug[] = []
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
