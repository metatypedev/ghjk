// deno-lint-ignore-file no-await-in-loop

export * from "./types.ts";

import { zod } from "./deps.ts";
import { Json, unwrapZodRes } from "../../deno_utils/mod.ts";
import logger from "../../deno_utils/logger.ts";
import validators, {
  installSetProvisionTy,
  installSetRefProvisionTy,
} from "./types.ts";
import type { InstallSetX, PortsModuleConfigX } from "./types.ts";
import { type ModuleManifest } from "../types.ts";
import { ModuleBase } from "../mod.ts";
import {
  buildInstallGraph,
  getResolutionMemo,
  syncCtxFromGhjk,
} from "./sync.ts";
import type { Blackboard } from "../types.ts";
import { getProvisionReducerStore } from "../envs/reducer.ts";
import { installSetReducer, installSetRefReducer } from "./reducers.ts";
import type { Provision, ProvisionReducer } from "../envs/types.ts";
import { getPortsCtx } from "./inter.ts";
import type { CliCommand } from "../types.ts";

export type PortsCtx = {
  config: PortsModuleConfigX;
};

const lockValidator = zod.object({
  version: zod.string(),
  configResolutions: zod.record(
    zod.string(),
    validators.installConfigResolved,
  ),
});
type PortsLockEnt = zod.infer<typeof lockValidator>;

export class PortsModule extends ModuleBase<PortsLockEnt> {
  loadConfig(
    manifest: ModuleManifest,
    bb: Blackboard,
    _lockEnt: PortsLockEnt | undefined,
  ) {
    function unwrapParseCurry<I, O>(res: zod.SafeParseReturnType<I, O>) {
      return unwrapZodRes<I, O>(res, {
        id: manifest.id,
        config: manifest.config,
      }, "error parsing module config");
    }

    const hashedModConf = unwrapParseCurry(
      validators.portsModuleConfigHashed.safeParse(manifest.config),
    );

    const gcx = this.gcx;
    const pcx = getPortsCtx(gcx);

    // pre-process the install sets found in the config
    for (const [id, hashedSet] of Object.entries(hashedModConf.sets)) {
      // install sets in the config use hash references to dedupe InstallConfigs,
      // AllowedDepSets and AllowedDeps
      // reify the references from the blackboard before continuing
      const installs = hashedSet.installs.map((hash) =>
        unwrapParseCurry(validators.installConfigFat.safeParse(bb[hash]))
      );
      const allowedDepSetHashed = unwrapParseCurry(
        validators.allowDepSetHashed.safeParse(
          bb[hashedSet.allowedBuildDeps],
        ),
      );
      const allowedBuildDeps = Object.fromEntries(
        Object.entries(allowedDepSetHashed).map((
          [key, hash],
        ) => [
          key,
          unwrapParseCurry(validators.allowedPortDep.safeParse(bb[hash])),
        ]),
      );
      const set: InstallSetX = {
        installs,
        allowedBuildDeps,
      };
      pcx.config.sets[id] = set;
    }

    // register envrionment reducers for any
    // environemnts making use of install sets
    const reducerStore = getProvisionReducerStore(gcx);
    reducerStore.set(
      installSetRefProvisionTy,
      installSetRefReducer(gcx, pcx) as ProvisionReducer<Provision, Provision>,
    );
    reducerStore.set(
      installSetProvisionTy,
      installSetReducer(gcx) as ProvisionReducer<Provision, Provision>,
    );
  }

  override commands() {
    const gcx = this.gcx;
    const pcx = getPortsCtx(gcx);

    const out: CliCommand[] = [{
      name: "ports",
      visible_aliases: ["p"],
      about: "Ports module, install programs into your env.",
      sub_commands: [
        {
          name: "resolve",
          about: "Resolve all installs declared in config.",
          before_long_help:
            `- Useful to pre-resolve and add all install configs to the lockfile.`,
          action: async function () {
            // scx contains a reference counted db connection
            // somewhere deep in there
            // so we need to use `using`
            await using scx = await syncCtxFromGhjk(gcx);
            for (const [_id, set] of Object.entries(pcx.config.sets)) {
              void await buildInstallGraph(scx, set);
            }
          },
        },
      ],
    }];
    return out;
  }

  loadLockEntry(raw: Json) {
    const entry = lockValidator.parse(raw);

    if (entry.version != "0") {
      throw new Error(`unexepected version tag deserializing lockEntry`);
    }
    const memoStore = getResolutionMemo(this.gcx);
    for (const [hash, config] of Object.entries(entry.configResolutions)) {
      logger().debug(
        "restoring resolution from lockfile",
        config.portRef,
        config.version,
      );
      memoStore.set(hash, Promise.resolve(config));
    }

    return entry;
  }

  async genLockEntry() {
    const memo = getResolutionMemo(this.gcx);
    const configResolutions = Object.fromEntries(
      await Array.fromAsync(
        [...memo.entries()].map(async ([key, prom]) => [key, await prom]),
      ),
    );
    return {
      version: "0",
      configResolutions: JSON.parse(JSON.stringify(configResolutions)),
    };
  }
}
