import { defaultInstallArgs, install } from "../install/mod.ts";
import { std_url } from "../deps/dev.ts";
import { $, dbg, importRaw } from "../utils/mod.ts";
import type {
  InstallConfigFat,
  PortsModuleSecureConfig,
} from "../modules/ports/types.ts";
import type { EnvDefArgs, TaskDefArgs } from "../mod.ts";
import logger from "../utils/logger.ts";
export type { EnvDefArgs, TaskDefArgs } from "../mod.ts";

export type E2eTestCase = {
  name: string;
  tsGhjkfileStr: string;
  envVars?: Record<string, string>;
  ePoints: { cmd: string | string[]; stdin?: string }[];
};

const dockerCmd = (Deno.env.get("DOCKER_CMD") ?? "docker").split(/\s/);
const dFileTemplate = await importRaw(import.meta.resolve("./test.Dockerfile"));
const templateStrings = {
  addConfig: `#{{CMD_ADD_CONFIG}}`,
};

export async function dockerE2eTest(testCase: E2eTestCase) {
  const { name, envVars: testEnvs, ePoints, tsGhjkfileStr } = testCase;
  const tag = `ghjk_e2e_${name}`;
  const env = {
    ...testEnvs,
  };
  const devGhjkPath = import.meta.resolve("../");

  const configFile = tsGhjkfileStr
    // replace all file urls that point to the ghjk
    // repo in the host fs to point to the copy of the
    // repo in the image
    .replaceAll(devGhjkPath, "file://$ghjk/")
    .replaceAll("$ghjk", "/ghjk");

  const dFile = dbg(dFileTemplate
    .replace(
      templateStrings.addConfig,
      configFile
        // escape all dollars
        .replaceAll("$", "$$$$"),
    ));

  await $
    .raw`${dockerCmd} buildx build ${
    Object.entries(env).map(([key, val]) => ["--build-arg", `${key}=${val}`])
  } --tag '${tag}' --network=host --output type=docker -f- .`
    .env(env)
    .stdinText(dFile);

  for (const ePoint of ePoints) {
    let cmd = $.raw`${dockerCmd} run --rm ${[
      /* we want to enable interactivity when piping in */
      ePoint.stdin ? "-i " : "",
      ...Object.entries(env).map(([key, val]) => ["-e", `${key}=${val}`])
        .flat(),
      tag,
    ]} ${ePoint.cmd}`
      .env(env);
    if (ePoint.stdin) {
      cmd = cmd.stdinText(ePoint.stdin!);
    }
    try {
      await cmd;
    } catch (err) {
      logger(import.meta).error(err);
      throw err;
    }
  }
  await $
    .raw`${dockerCmd} rmi '${tag}'`
    .env(env);
}

export async function localE2eTest(testCase: E2eTestCase) {
  const { envVars: testEnvs, ePoints, tsGhjkfileStr } = testCase;
  const tmpDir = $.path(
    await Deno.makeTempDir({
      prefix: "ghjk_le2e_",
    }),
  );
  const ghjkShareDir = await tmpDir.join("ghjk").ensureDir();

  await tmpDir.join("ghjk.ts").writeText(
    tsGhjkfileStr.replaceAll(
      "$ghjk",
      std_url.dirname(import.meta.resolve("../mod.ts")).href,
    ),
  );
  const env: Record<string, string> = {
    ...testEnvs,
    BASH_ENV: `${ghjkShareDir.toString()}/env.bash`,
    ZDOTDIR: ghjkShareDir.toString(),
    GHJK_SHARE_DIR: ghjkShareDir.toString(),
    PATH: `${ghjkShareDir.toString()}:${Deno.env.get("PATH")}`,
    // shield tests from external envs
    GHJK_ENV: "main",
    HOME: tmpDir.toString(),
  };
  // install ghjk
  await install({
    ...defaultInstallArgs,
    skipExecInstall: false,
    ghjkExecInstallDir: ghjkShareDir.toString(),
    // share the system's deno cache
    ghjkDenoCacheDir: Deno.env.get("DENO_DIR") ??
      $.path(Deno.env.get("HOME")!).join(".cache", "deno").toString(),
    ghjkShareDir: ghjkShareDir.toString(),
    // don't modify system shell configs
    shellsToHook: [],
  });

  await $`${ghjkShareDir.join("ghjk").toString()} print config`
    .cwd(tmpDir.toString())
    .env(env);
  await $`${ghjkShareDir.join("ghjk").toString()} ports sync`
    .cwd(tmpDir.toString())
    .env(env);
  /*
  // print the contents of the ghjk dir for debugging purposes
  const ghjkDirLen = ghjkDir.toString().length;
  dbg((await Array.fromAsync(ghjkShareDir.walk())).map((entry) => [
    entry.isDirectory ? "dir " : entry.isSymlink ? "ln  " : "file",
    entry.path.toString().slice(ghjkDirLen),
  ]));
  */
  {
    const confHome = await ghjkShareDir.join(".config").ensureDir();
    const fishConfDir = await confHome.join("fish").ensureDir();
    await fishConfDir.join("config.fish").createSymlinkTo(
      ghjkShareDir.join("env.fish").toString(),
    );
    env["XDG_CONFIG_HOME"] = confHome.toString();
  }
  for (const ePoint of ePoints) {
    let cmd = $.raw`${ePoint.cmd}`
      .cwd(tmpDir.toString())
      .clearEnv()
      .env(env);
    if (ePoint.stdin) {
      cmd = cmd.stdinText(ePoint.stdin);
    }
    await cmd;
  }
  await tmpDir.remove({ recursive: true });
}

export function genTsGhjkFile(
  { installConf, secureConf, taskDefs, envDefs }: {
    installConf?: InstallConfigFat | InstallConfigFat[];
    secureConf?: PortsModuleSecureConfig;
    taskDefs?: TaskDefArgs[];
    envDefs?: EnvDefArgs[];
  },
) {
  const installConfArray = installConf
    ? Array.isArray(installConf) ? installConf : [installConf]
    : [];

  const serializedPortsInsts = JSON.stringify(
    installConfArray,
    (_, val) =>
      typeof val == "string"
        // we need to escape a json string embedded in a js string
        // 2x
        ? val.replaceAll(/\\/g, "\\\\")
        : val,
  );
  const serializedSecConf = JSON.stringify(
    // undefined is not recognized by JSON.parse
    // so we stub it with null
    secureConf ?? null,
    (_, val) => typeof val == "string" ? val.replaceAll(/\\/g, "\\\\") : val,
  );
  const tasks = (taskDefs ?? []).map(
    (def) => {
      const stringifiedSection = JSON.stringify(
        def,
        (_, val) =>
          typeof val == "string" ? val.replaceAll(/\\/g, "\\\\") : val,
      );
      return $.dedent`
      ghjk.task({
        ...JSON.parse(\`${stringifiedSection}\`),
        fn: ${def.fn.toString()}
      })`;
    },
  ).join("\n");
  const envs = (envDefs ?? []).map(
    (def) => {
      const stringifiedSection = JSON.stringify(
        def,
        (_, val) =>
          typeof val == "string" ? val.replaceAll(/\\/g, "\\\\") : val,
      );
      return $.dedent`
      ghjk.env({
        ...JSON.parse(\`${stringifiedSection}\`),
      })`;
    },
  ).join("\n");
  return `
export { ghjk } from "$ghjk/mod.ts";
import * as ghjk from "$ghjk/mod.ts";
const confStr = \`
${serializedPortsInsts}
\`;
const confObj = JSON.parse(confStr);
ghjk.install(...confObj)

const secConfStr = \`
${serializedSecConf}
\`;
export const secureConfig = JSON.parse(secConfStr);

${tasks}
${envs}
`;
}
