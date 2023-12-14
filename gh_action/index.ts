import * as core from "@actions/core";
import * as tc from "@actions/tool-cache";
import * as cache from "@actions/cache";
import * as exec from "@actions/exec";
import * as path from "path";

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
async function run(): Promise<void> {
  try {
    const inputVersion = core.getInput("version");
    const inputInstallerUrl = core.getInput("installer-url");
    const inputSync = core.getInput("sync");
    const inputSkipDenoInstall = core.getInput("skip-deno-install");

    const version = inputVersion.length > 0
      ? inputVersion
      : process.env["GHJK_VERSION"] ?? process.env["GITHUB_ACTION_REF"];

    const installerUrl = inputInstallerUrl.length > 0
      ? inputInstallerUrl
      : !!version
      ? `https://raw.github.com/metatypedev/ghjk/${version}/install.ts`
      : `${process.env.GITHUB_ACTION_PATH}/install.ts`;

    const execDir = await install(
      version,
      installerUrl,
      inputSkipDenoInstall == "true",
    );

    core.addPath(execDir);

    if (inputSync == "true") {
      await exec.exec("ghjk", ["print", "config"]);
      await exec.exec("ghjk", ["ports", "sync"]);
    }

    const ghjkDir =
      (await exec.getExecOutput("ghjk", ["print", "ghjk-dir-path"])).stdout
        .trim();

    core.setOutput("GHJK_DIR", ghjkDir);
    core.exportVariable("GHJK_DIR", ghjkDir);
    core.exportVariable("BASH_ENV", `${ghjkDir}/env.sh`);
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) core.setFailed(error.message);
  }
}

async function install(
  version: string | undefined,
  installerUrl: string,
  skipDenoInstall: boolean,
) {
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
  core.debug(`installing ghjk using install.sh`);

  const installDir = process.env["GHJK_INSTALL_EXE_DIR"] ?? "/ghjk-exec";
  const env: Record<string, string> = {
    GHJK_INSTALLER_URL: installerUrl,
    GHJK_INSTALL_EXE_DIR: installDir,
  };

  if (skipDenoInstall && !process.env["GHJK_INSTALL_DENO_EXEC"]) {
    const denoOut = await exec.getExecOutput("deno", ["--version"]);
    if (denoOut.exitCode != 0) {
      throw new Error("skip-deno-install set but no deno binary found");
    }
    env["GHJK_INSTALL_DENO_EXEC"] = "deno";
    core.debug(`skipping deno install & using found "deno" bin`);
  }

  core.debug(`${process.cwd()}`);
  await exec.exec(
    `"${path.resolve(process.env.GITHUB_ACTION_PATH ?? "", "install.sh")}"`,
    [],
    {
      env: {
        ...process.env as Record<string, string>,
        ...env,
      },
    },
  );
  if (version) {
    return await tc.cacheDir(installDir, "ghjk", "ghjk", version);
  }
  return `${installDir}/ghjk`;
}

void run();
