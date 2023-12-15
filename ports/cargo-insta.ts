import { ALL_ARCH, ALL_OS, InstallConfigSimple, osXarch } from "../port.ts";
import * as std_ports from "../modules/ports/std.ts";
import { CargoBinstallPort } from "../modules/ports/cargo-binstall.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "cargo_insta_cbinst",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [
    std_ports.cbin_ghrel,
  ],
  platforms: osXarch([...ALL_OS], [...ALL_ARCH]),
};

export default function conf(config: InstallConfigSimple = {}) {
  return {
    ...config,
    port: manifest,
  };
}

export class Port extends CargoBinstallPort {
  crateName = "cargo-insta";
}
