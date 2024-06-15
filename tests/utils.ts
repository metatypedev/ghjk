import { defaultInstallArgs, install } from "../install/mod.ts";
import { std_url } from "../deps/dev.ts";
import { std_async } from "../deps/dev.ts";
import { $, dbg, importRaw } from "../utils/mod.ts";
import logger from "../utils/logger.ts";
import type { DenoTaskDefArgs, FileArgs } from "../mod.ts";
export type { EnvDefArgs } from "../mod.ts";
import { ALL_OS } from "../port.ts";
import { ALL_ARCH } from "../port.ts";

export type E2eTestCase = {
  name: string;
  tsGhjkfileStr: string;
  envVars?: Record<string, string>;
  ePoints: { cmd: string | string[]; stdin?: string }[];
  timeout_ms?: number;
  ignore?: boolean;
  only?: boolean;
};

export const testTargetPlatform = Deno.env.get("DOCKER_PLATFORM") ??
  (Deno.build.os + "/" + Deno.build.arch);

if (
  !([...ALL_OS] as string[]).includes(testTargetPlatform.split("/")[0]) ||
  !([...ALL_ARCH] as string[]).includes(testTargetPlatform.split("/")[1])
) {
  throw new Error(`unsupported test platform: ${testTargetPlatform}`);
}

const dockerPlatform = `--platform=${
  testTargetPlatform
    .replace("x86_64", "amd64")
    .replace("aarch64", "arm64")
}`;

const dockerCmd = (Deno.env.get("DOCKER_CMD") ?? "docker").split(/\s/);

const dFileTemplate = await importRaw(import.meta.resolve("./test.Dockerfile"));
const templateStrings = {
  addConfig: `#{{CMD_ADD_CONFIG}}`,
};
const noRmi = Deno.env.get("DOCKER_NO_RMI");

export async function dockerE2eTest(testCase: E2eTestCase) {
  const { name, envVars: testEnvs, ePoints, tsGhjkfileStr } = testCase;
  const tag = `ghjk_e2e_${name}`.toLowerCase();
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
    .raw`${dockerCmd} buildx build ${dockerPlatform} ${
    Object.entries(env).map(([key, val]) => ["--build-arg", `${key}=${val}`])
  } --tag '${tag}' --network=host --output type=docker -f- .`
    .env(env)
    .stdinText(dFile);

  for (const ePoint of ePoints) {
    let cmd = $.raw`${dockerCmd} run ${dockerPlatform} --rm ${[
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
  if (!noRmi) {
    await $
      .raw`${dockerCmd} rmi '${tag}'`
      .env(env);
  }
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
    .clearEnv()
    .env(env);
  await $`${ghjkShareDir.join("ghjk").toString()} envs cook`
    .cwd(tmpDir.toString())
    .clearEnv()
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
    await fishConfDir.join("config.fish").symlinkTo(
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

export type TaskDef =
  & Omit<DenoTaskDefArgs, "fn">
  & Required<Pick<DenoTaskDefArgs, "fn">>;

export function genTsGhjkFile(
  { secureConf }: {
    secureConf?: FileArgs;
  },
) {
  const serializedSecConf = JSON.stringify(
    // undefined is not recognized by JSON.parse
    // so we stub it with null
    {
      ...secureConf,
      tasks: [],
    },
    // we need to escape a json string embedded in a js string
    // 2x
    (_, val) => typeof val == "string" ? val.replaceAll(/\\/g, "\\\\") : val,
    2,
  );

  const tasks = Object.entries(secureConf?.tasks ?? {}).map(
    ([name, def]) => {
      const stringifiedSection = JSON.stringify(
        { ...def, name },
        (_, val) =>
          typeof val == "string" ? val.replaceAll(/\\/g, "\\\\") : val,
        2,
      );
      return $.dedent`
      ghjk.task({
        ...JSON.parse(\`${stringifiedSection}\`),
        fn: ${def.fn?.toString()}
      })`;
    },
  ).join("\n");

  return `
import { file } from "$ghjk/mod.ts";

const confStr = \`
${serializedSecConf}
\`;
const confObj = JSON.parse(confStr);
const ghjk = file(confObj);

export const sophon = ghjk.sophon;

${tasks}

`;
}

export function harness(
  cases: E2eTestCase[],
) {
  const e2eType = Deno.env.get("GHJK_TEST_E2E_TYPE");
  let runners = [[dockerE2eTest, "e2eDocker" as string] as const];
  if (e2eType == "both") {
    runners.push([localE2eTest, "e2eLocal"]);
  } else if (e2eType == "local") {
    runners = [[localE2eTest, "e2eLocal"]];
  } else if (
    e2eType && e2eType != "docker"
  ) {
    throw new Error(
      `unexpected GHJK_TEST_E2E_TYPE: ${e2eType}`,
    );
  }
  for (const [runner, group] of runners) {
    for (const testCase of cases) {
      Deno.test(
        `${group}/${testCase.name}`,
        {
          ignore: testCase.ignore,
        },
        () =>
          std_async.deadline(
            runner({
              ...testCase,
            }),
            // building the test docker image might taka a while
            // but we don't want some bug spinlocking the ci for
            // an hour
            testCase.timeout_ms ?? 5 * 60 * 1000,
          ),
      );
    }
  }
}
