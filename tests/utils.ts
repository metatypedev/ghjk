import { defaultInstallArgs, install } from "../install/mod.ts";
import { std_url } from "../deps/dev.ts";
import { std_async } from "../deps/dev.ts";
import { $ } from "../utils/mod.ts";
import type { DenoTaskDefArgs, FileArgs } from "../mod.ts";
import { ALL_ARCH, ALL_OS } from "../modules/ports/types/platform.ts";
export type { EnvDefArgs } from "../mod.ts";

export const testTargetPlatform = Deno.env.get("DOCKER_PLATFORM") ??
  (Deno.build.os + "/" + Deno.build.arch);

if (
  !([...ALL_OS] as string[]).includes(testTargetPlatform.split("/")[0]) ||
  !([...ALL_ARCH] as string[]).includes(testTargetPlatform.split("/")[1])
) {
  throw new Error(`unsupported test platform: ${testTargetPlatform}`);
}

export type E2eTestCase = {
  name: string;
  fs: Record<string, string>;
  envVars?: Record<string, string>;
  ePoints: { cmd: string | string[]; stdin?: string }[];
  timeout_ms?: number;
  ignore?: boolean;
  only?: boolean;
};

export async function localE2eTest(testCase: E2eTestCase) {
  const { envVars: testEnvs, ePoints, fs } = testCase;
  const tmpDir = $.path(
    await Deno.makeTempDir({
      prefix: "ghjk_le2e_",
    }),
  );
  const ghjkDataDir = await tmpDir.join("ghjk").ensureDir();

  await $.co(
    Object.entries(fs)
      .map(
        ([path, content]) =>
          tmpDir.join(path)
            .writeText(
              content.replaceAll(
                "$ghjk",
                std_url.dirname(import.meta.resolve("../mod.ts")).href,
              ),
            ),
      ),
  );
  const ghjkExePath = $.path(import.meta.resolve("../target/debug/ghjk"));
  const ghjkShimPath = await ghjkDataDir
    .join("ghjk")
    .writeText(
      `#!/bin/sh
exec ${ghjkExePath.resolve().toString()} "$@"`,
      { mode: 0o700 },
    );

  const env: Record<string, string | undefined> = {
    GHJK_AUTO_HOOK: "true",
    BASH_ENV: `${ghjkDataDir.toString()}/env.bash`,
    ZDOTDIR: ghjkDataDir.toString(),
    GHJK_DATA_DIR: ghjkDataDir.toString(),
    PATH: `${ghjkShimPath.parentOrThrow().toString()}:${Deno.env.get("PATH")}`,
    HOME: tmpDir.toString(),
    GHJK_REPO_ROOT: import.meta.resolve("../"),
    // share the system's deno cache
    GHJK_DENO_DIR: Deno.env.get("DENO_DIR")
      ? $.path(Deno.env.get("DENO_DIR")!).resolve().toString()
      : $.path(Deno.env.get("HOME")!).resolve(".cache", "deno").toString(),
    RUST_LOG: Deno.env.get("RUST_LOG"),
    GHJK_LOG: Deno.env.get("GHJK_LOG"),
    ...testEnvs,
  };
  // install ghjk
  await install({
    ...defaultInstallArgs,
    ghjkDataDir: ghjkDataDir.toString(),
    // don't modify system shell configs
    shellsToHook: [],
  });

  await $`ghjk print serialized`
    .cwd(tmpDir.toString())
    .clearEnv()
    .env(env);
  await $`ghjk envs cook`
    .cwd(tmpDir.toString())
    .clearEnv()
    .env(env);
  /*
  // print the contents of the ghjk dir for debugging purposes
  const ghjkDirLen = ghjkDir.toString().length;
  dbg((await Array.fromAsync(ghjkDataDir.walk())).map((entry) => [
    entry.isDirectory ? "dir " : entry.isSymlink ? "ln  " : "file",
    entry.path.toString().slice(ghjkDirLen),
  ]));
  */
  {
    const confHome = await tmpDir.join(".config").ensureDir();
    const fishConfDir = await confHome.join("fish").ensureDir();
    await fishConfDir.join("config.fish").symlinkTo(
      ghjkDataDir.join("env.fish").toString(),
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
export { sophon } from "ghjk";
import { file } from "ghjk";

const confStr = \`
${serializedSecConf}
\`;
const confObj = JSON.parse(confStr);
const ghjk = file(confObj);

${tasks}

`;
}

export function harness(
  cases: E2eTestCase[],
) {
  const e2eType = Deno.env.get("GHJK_TEST_E2E_TYPE");
  const runners = [
    [localE2eTest, "e2eLocal"] as const,
  ];
  if (e2eType && e2eType != "local") {
    throw new Error("docker test runner has been removed");
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
