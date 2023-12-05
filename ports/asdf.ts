import {
  addInstallGlobal,
  asdf,
  AsdfInstallConfig,
  registerAsdfPort,
} from "../port.ts";

registerAsdfPort();
export default function install(config: Omit<AsdfInstallConfig, "portName">) {
  addInstallGlobal({
    portName: asdf.manifest.name,
    ...config,
  });
}
