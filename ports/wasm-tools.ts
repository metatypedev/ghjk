import {
  addInstallGlobal,
  type InstallConfigSimple,
  registerDenoPortGlobal,
} from "../port.ts";
import { CargoBinstallPort } from "../modules/ports/cargo-binstall.ts";
import * as std_ports from "../modules/ports/std.ts";

const manifest = {
  ty: "denoWorker" as const,
  name: "wasm-tools@cbinst",
  version: "0.1.0",
  moduleSpecifier: import.meta.url,
  deps: [
    std_ports.cbin_ghrel,
  ],
};

registerDenoPortGlobal(manifest, () => new Port());

export default function install(config: InstallConfigSimple = {}) {
  addInstallGlobal({
    portName: manifest.name,
    ...config,
  });
}

export class Port extends CargoBinstallPort {
  manifest = manifest;
  crateName = "wasm-tools";
}
