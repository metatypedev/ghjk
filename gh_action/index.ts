import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import * as cache from "@actions/cache";
import * as exec from "@actions/exec";
import * as path from "path";
import * as os from "os";
import crypto from "crypto";

// TODO: auto-manage this version
const DENO_VERSION = "1.38.5";

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function main(): Promise<void> {
  try {
    const inputVersion = core.getInput("version");
    const inputInstallerUrl = core.getInput("installer-url");
    const inputSync = core.getInput("sync");
    const inputSkipDenoInstall = core.getInput("skip-deno-install");
    const inputCacheDisable = core.getInput("cache-disable");
    const inputCacheKeyPrefix = core.getInput("cache-key-prefix");
    const inputCacheSaveIf = core.getInput("cache-save-if");
    const inputCacheKeyEnvVars = core.getInput("cache-key-env-vars");

    const version = inputVersion.length > 0
      ? inputVersion
      : process.env["GHJK_VERSION"] ?? process.env["GITHUB_ACTION_REF"];

    const installerUrl = inputInstallerUrl.length > 0
      ? inputInstallerUrl
      : !!version
      ? `https://raw.github.com/metatypedev/ghjk/${version}/install.ts`
      : `${process.env["GITHUB_ACTION_PATH"] ?? ""}install.ts`;

    const execDir = await installGhjk(
      version,
      installerUrl,
      inputSkipDenoInstall == "true",
    );

    core.addPath(execDir);

    const configStr =
      (await exec.getExecOutput("ghjk", ["print", "config"])).stdout;

    const ghjkDir =
      (await exec.getExecOutput("ghjk", ["print", "ghjk-dir-path"], {
        silent: true,
      }))
        .stdout
        .trim();

    if (inputCacheDisable == "false" && cache.isFeatureAvailable()) {
      const ghjkVersion =
        (await exec.getExecOutput("ghjk", ["--version"], { silent: true }))
          .stdout
          .trim();

      const configPath =
        (await exec.getExecOutput("ghjk", ["print", "config-path"], {
          silent: true,
        }))
          .stdout
          .trim();

      let hasher = crypto.createHash("sha1");

      hasher.update(ghjkVersion);
      hasher.update(configPath);
      // TODO: consider ignoring config to avoid misses just for one dep change
      hasher.update(configStr);

      const hashedEnvs = [
        "GHJK",
        "DENO",
        ...(inputCacheKeyEnvVars.split(",").filter((str) => str.length > 0).map(
          (str) => str.trim(),
        )),
      ];
      for (const [key, val] of Object.entries(process.env)) {
        if (hashedEnvs.some((pfix) => key.startsWith(pfix))) {
          hasher.update(`${key}=${val}`);
        }
      }
      const hash = hasher.digest("hex");
      const keyPrefix = inputCacheKeyPrefix.length > 0
        ? inputCacheKeyPrefix
        : "v0-ghjk";
      const key = `${keyPrefix}-${hash}`;

      const envsDir = core.toPlatformPath(path.resolve(ghjkDir, "envs"));
      const cacheDirs = [envsDir];
      core.info(JSON.stringify({ cacheDirs, envsDir, ghjkDir }));
      // NOTE: restoreCache modifies the array it's given for some reason
      await cache.restoreCache([...cacheDirs], key);
      if (inputCacheSaveIf == "true") {
        core.info(`enabling cache with key ${key}: [${cacheDirs}]`);
        core.saveState("ghjk-cache-save", true);
        core.saveState("ghjk-post-args", {
          key,
          cacheDirs,
        });
      }
    }

    if (inputSync == "true") {
      await exec.exec("ghjk", ["ports", "sync"]);
    }

    core.setOutput("GHJK_DIR", ghjkDir);
    core.exportVariable("GHJK_DIR", ghjkDir);
    core.exportVariable("BASH_ENV", `${ghjkDir}/env.sh`);
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message);
  }
}

export async function installGhjk(
  version: string | undefined,
  installerUrl: string,
  skipDenoInstall: boolean,
) {
  let denoExec = "deno";
  if (skipDenoInstall && !process.env["GHJK_INSTALL_DENO_EXEC"]) {
    const denoOut = await exec.getExecOutput("deno", ["--version"]);
    if (denoOut.exitCode != 0) {
      throw new Error("skip-deno-install set but no deno binary found");
    }
    core.debug(`skipping deno install & using found "deno" bin`);
  } else {
    denoExec = await installDeno(process.env["DENO_VERSION"] ?? DENO_VERSION);
  }

  if (version) {
    const foundExecDir = tc.find("ghjk", version);
    if (foundExecDir.length != 0) {
      core.debug(
        `found cached ghjk tool under version ${version}: ${foundExecDir}`,
      );
      return foundExecDir;
    } else {
      core.debug(`unable to find cached ghjk tool under version ${version}`);
    }
  }
  core.debug(`installing ghjk using install.ts`);

  const installDir = process.env["GHJK_INSTALL_EXE_DIR"] ??
    core.toPlatformPath(path.resolve(os.homedir(), ".local", "bin"));
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    GHJK_INSTALL_EXE_DIR: installDir,
    SHELL: "bash",
  };
  // NOTE: we make the ghjk bin use whichver deno is avail in path
  // to avoid it hardcoding the current deno bin path
  // which won't be the same after tool cache restore
  env["GHJK_INSTALL_DENO_EXEC"] = "deno";

  core.debug(JSON.stringify({ denoExec, env }, undefined, "  "));
  await exec.exec(`"${denoExec}" run -A`, [installerUrl], { env });
  if (version) {
    return await tc.cacheDir(installDir, "ghjk", version);
  }
  return installDir;
}

export async function installDeno(version: string) {
  // The following is modified from
  // <https://github.com/denoland/setup-deno>
  // MIT License
  // Copyright (c) 2021 Deno Land

  function zipName() {
    let arch;
    switch (process.arch) {
      case "arm64":
        arch = "aarch64";
        break;
      case "x64":
        arch = "x86_64";
        break;
      default:
        throw new Error(`Unsupported architechture ${process.arch}.`);
    }

    let platform;
    switch (process.platform) {
      case "linux":
        platform = "unknown-linux-gnu";
        break;
      case "darwin":
        platform = "apple-darwin";
        break;
      case "win32":
        platform = "pc-windows-msvc";
        break;
      default:
        throw new Error(`Unsupported platform ${process.platform}.`);
    }

    return `deno-${arch}-${platform}.zip`;
  }
  const cachedPath = tc.find("ghjk-deno", version);
  if (cachedPath) {
    core.info(`Using cached Deno installation from ${cachedPath}.`);
    core.addPath(cachedPath);
    return `${cachedPath}/deno`;
  }

  const zip = zipName();
  const url =
    `https://github.com/denoland/deno/releases/download/v${version}/${zip}`;

  core.info(`Downloading Deno from ${url}.`);

  const zipPath = await tc.downloadTool(url);
  const extractedFolder = await tc.extractZip(zipPath);

  const newCachedPath = await tc.cacheDir(
    extractedFolder,
    "ghjk-deno",
    version,
  );
  core.info(`Cached Deno to ${newCachedPath}.`);
  core.addPath(newCachedPath);
  return `${newCachedPath}/deno`;
}

/**
 * The post function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function post(): Promise<void> {
  try {
    if (
      cache.isFeatureAvailable() && core.getState("ghjk-cache-save") == "true"
    ) {
      const argsStr = core.getState("ghjk-post-args");
      core.info(argsStr);
      const args = JSON.parse(argsStr);
      const {
        key,
        cacheDirs,
      } = args;
      await cache.saveCache(cacheDirs, key);
    } else {
      core.info("cache-save flag is false, skipping");
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message);
  }
}
