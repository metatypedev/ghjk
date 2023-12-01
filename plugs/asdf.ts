import {
  addInstallGlobal,
  asdf,
  AsdfInstallConfig,
  registerAsdfPlug,
} from "../port.ts";

registerAsdfPlug();
export default function install(config: Omit<AsdfInstallConfig, "plugName">) {
  addInstallGlobal({
    plugName: asdf.manifest.name,
    ...config,
  });
}
