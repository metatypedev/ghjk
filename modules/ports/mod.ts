export * from "./types.ts";

import { cliffy_cmd } from "../../deps/cli.ts";
import { semver } from "../../deps/common.ts";

import validators, {
  type AmbientAccessPortManifest,
  type DenoWorkerPortManifest,
  type InstallConfig,
  type PortManifest,
  type PortsModuleConfig,
  type PortsModuleConfigBase,
} from "./types.ts";
import { type GhjkCtx } from "../types.ts";
import logger from "../../utils/logger.ts";
import { ModuleBase } from "../mod.ts";
import { sync } from "./sync.ts";

export class PortsModule extends ModuleBase {
  constructor(
    public ctx: GhjkCtx,
    public config: PortsModuleConfig,
  ) {
    super();
  }
  command() {
    return new cliffy_cmd.Command()
      // .alias("port")
      .action(function () {
        this.showHelp();
      })
      .description("Ports module, install programs into your env.")
      .command(
        "sync",
        new cliffy_cmd.Command().description("Syncs the environment.")
          .action(() => sync(this.ctx.envDir, this.config)),
      )
      .command(
        "list",
        new cliffy_cmd.Command().description("")
          .action(() => {
            console.log(
              this.config.installs.map((install) => ({
                install,
                port: this.config.ports[install.portName],
              })),
            );
          }),
      )
      .command("outdated", new cliffy_cmd.Command())
      .command("cleanup", new cliffy_cmd.Command())
      .command("completions", new cliffy_cmd.CompletionsCommand());
  }
}

export function registerDenoPort(
  cx: PortsModuleConfigBase,
  manifest: DenoWorkerPortManifest,
) {
  registerPort(cx, manifest);
}

export function registerAmbientPort(
  cx: PortsModuleConfigBase,
  manifest: AmbientAccessPortManifest,
) {
  registerPort(cx, manifest);
}

export function registerPort(
  cx: PortsModuleConfigBase,
  manifestUnclean: PortManifest,
) {
  const manifest = validators.portManifest.parse(manifestUnclean);
  const conflict = cx.ports[manifest.name];
  if (conflict) {
    if (
      conflict.conflictResolution == "override" &&
      manifest.conflictResolution == "override"
    ) {
      throw new Error(
        `Two instances of port "${manifest.name}" found with ` +
          `both set to "${manifest.conflictResolution}" conflictResolution"`,
      );
    } else if (conflict.conflictResolution == "override") {
      logger().debug("port rejected due to override", {
        retained: conflict,
        rejected: manifest,
      });
      // do nothing
    } else if (manifest.conflictResolution == "override") {
      logger().debug("port override", {
        new: manifest,
        replaced: conflict,
      });
      cx.ports[manifest.name] = manifest;
    } else if (
      semver.compare(
        semver.parse(manifest.version),
        semver.parse(conflict.version),
      ) == 0
    ) {
      throw new Error(
        `Two instances of the port "${manifest.name}" found with an identical version` +
          `and both set to "deferToNewer" conflictResolution.`,
      );
    } else if (
      semver.compare(
        semver.parse(manifest.version),
        semver.parse(conflict.version),
      ) > 0
    ) {
      logger().debug("port replaced after version defer", {
        new: manifest,
        replaced: conflict,
      });
      cx.ports[manifest.name] = manifest;
    } else {
      logger().debug("port rejected due after defer", {
        retained: conflict,
        rejected: manifest,
      });
    }
  } else {
    logger().debug("port registered", manifest.name);
    cx.ports[manifest.name] = manifest;
  }
}

export function addInstall(
  cx: PortsModuleConfigBase,
  configUnclean: InstallConfig,
) {
  const config = validators.installConfig.parse(configUnclean);
  if (!cx.ports[config.portName]) {
    throw new Error(
      `unrecognized port "${config.portName}" specified by install ${
        JSON.stringify(config)
      }`,
    );
  }
  logger().debug("install added", config);
  cx.installs.push(config);
}
