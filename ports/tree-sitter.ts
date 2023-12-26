import { InstallConfigSimple, osXarch } from "../port.ts";
import { CargoBinstallPort } from "../modules/ports/cargo-binstall.ts";
import * as std_ports from "../modules/ports/std.ts";
import { GithubReleasesInstConf, readGhVars } from "../modules/ports/ghrel.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "tree_sitter_cbinst",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [std_ports.cbin_ghrel],
  platforms: osXarch(["linux", "darwin", "windows"], ["aarch64", "x86_64"]),
};

export default function conf(
  config: InstallConfigSimple & GithubReleasesInstConf = {},
) {
  return {
    ...readGhVars(),
    ...config,
    port: manifest,
  };
}

export class Port extends CargoBinstallPort {
  crateName = "tree-sitter-cli";
}
