import type { Provision } from "../envs/types.ts";
import type { GhjkCtx } from "../types.ts";
import type { TaskAliasProvision } from "./types.ts";

/**
 * Reducer that converts task alias provisions to shell function provisions.
 * This allows tasks to be available as shell aliases when environments are activated.
 */

export function installTaskAliasReducer(_gcx: GhjkCtx) {
  return (provisions: Provision[]) => {
    const output = [];

    for (const provision of provisions) {
      const taskAliasProv = provision as TaskAliasProvision;

      // Convert task alias provision to shell function provision
      // This will be handled by the environment system to generate shell functions
      output.push({
        ty: "ghjk.shell.Alias",
        aliasName: taskAliasProv.aliasName,
        command: ["ghjk", "x", taskAliasProv.taskName],
      });
    }

    return Promise.resolve(output);
  };
}
