import * as core from "@actions/core";
import * as cache from "@actions/cache";

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
async function run(): Promise<void> {
  try {
    if (core.getState("cache-save") == "true") {
      const argsStr = core.getState("post-args");
      core.info(argsStr);
      const args = JSON.parse(argsStr);
      const {
        key,
        cacheDirs,
      } = args;
      await cache.saveCache(cacheDirs, key);
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message);
  }
}

void run();
