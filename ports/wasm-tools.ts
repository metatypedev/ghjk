import { InstallConfigSimple, osXarch } from "../port.ts";
import { CargoBinstallPort } from "../modules/ports/cargo-binstall.ts";
import * as std_ports from "../modules/ports/std.ts";

const manifest = {
  ty: "denoWorker@v1" as const,
  name: "wasm_tools_cbinst",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [
    std_ports.cbin_ghrel,
  ],
  platforms: osXarch(["linux", "darwin", "windows"], ["aarch64", "x86_64"]),
};
export default function conf(config: InstallConfigSimple = {}) {
  return {
    ...config,
    port: manifest,
  };
}

export class Port extends CargoBinstallPort {
  crateName = "wasm-tools";
}
