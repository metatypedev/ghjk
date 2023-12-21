import { defaultInstallArgs, install } from "../install/mod.ts";
import type {
  InstallConfigFat,
  PortsModuleSecureConfig,
} from "../modules/ports/types.ts";
import { std_url } from "../deps/common.ts";
import { $, dbg, importRaw } from "../utils/mod.ts";

export type E2eTestCase = {
  name: string;
  installConf: InstallConfigFat | InstallConfigFat[];
  secureConf?: PortsModuleSecureConfig;
  envs?: Record<string, string>;
  ePoints: { cmd: string; stdin?: string }[];
};

const dockerCmd = (Deno.env.get("DOCKER_CMD") ?? "docker").split(/\s/);
const dFileTemplate = await importRaw(import.meta.resolve("./test.Dockerfile"));
const templateStrings = {
  addConfig: `#{{CMD_ADD_CONFIG}}`,
};

export async function dockerE2eTest(testCase: E2eTestCase) {
  const { name, envs: testEnvs, ePoints, installConf, secureConf } = testCase;
  const tag = `ghjk_e2e_${name}`;
  const env = {
    ...testEnvs,
  };
  const installConfArray = Array.isArray(installConf)
    ? installConf
    : [installConf];
  const devGhjkPath = import.meta.resolve("../");
  const serializedPortsInsts = JSON.stringify(
    installConfArray,
    (_, val) =>
      typeof val == "string"
        ? val
          // replace all file urls that point to the ghjk
          // repo in the host fs to point to the copy of the
          // repo in the image
          .replace(devGhjkPath, "file://$ghjk/")
          .replaceAll(
            /\\/g,
            // we need to escape from a json string embedded js string
            // embedded embeded in a js file embedded in a Dockerfile
            // 4x
            "\\\\\\\\",
          )
        : val,
  );
  const serializedSecConf = JSON.stringify(
    // undefined is not recognized by JSON.parse
    // so we stub it with null
    secureConf ?? null,
    (_, val) =>
      typeof val == "string"
        ? val.replace(devGhjkPath, "file://$ghjk/").replaceAll(
          /\\/g,
          "\\\\\\\\",
        )
        : val,
  );

  const configFile = `
export { ghjk } from "$ghjk/mod.ts";
import * as ghjk from "$ghjk/mod.ts";
const confStr = \\\`
${serializedPortsInsts}
\\\`;
const confObj = JSON.parse(confStr);
ghjk.install(...confObj)

const secConfStr = \\\`
${serializedSecConf}
\\\`;
export const secureConfig = JSON.parse(secConfStr);
`.replaceAll("$ghjk", "/ghjk");

  const dFile = dbg(dFileTemplate.replaceAll(
    templateStrings.addConfig,
    configFile,
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
      ePoint.cmd,
    ]}`
      .env(env);
    if (ePoint.stdin) {
      cmd = cmd.stdinText(ePoint.stdin);
    }
    await cmd;
  }
  await $
    .raw`${dockerCmd} rmi '${tag}'`
    .env(env);
}

export async function localE2eTest(testCase: E2eTestCase) {
  const { envs: testEnvs, installConf, ePoints, secureConf } = testCase;
  const tmpDir = $.path(
    await Deno.makeTempDir({
      prefix: "ghjk_le2e_",
    }),
  );
  const ghjkDir = await tmpDir.join("ghjk").ensureDir();

  const installConfArray = Array.isArray(installConf)
    ? installConf
    : [installConf];

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
  await tmpDir.join("ghjk.ts").writeText(
    `
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
;
`
      .replaceAll(
        "$ghjk",
        std_url.dirname(import.meta.resolve("../mod.ts")).href,
      ),
  );
  const env: Record<string, string> = {
    ...testEnvs,
    BASH_ENV: `${ghjkDir.toString()}/env.bash`,
    ZDOTDIR: ghjkDir.toString(),
    GHJK_DIR: ghjkDir.toString(),
  };
  // install ghjk
  await install({
    ...defaultInstallArgs,
    skipExecInstall: false,
    ghjkExecInstallDir: ghjkDir.toString(),
    // share the system's deno cache
    ghjkDenoCacheDir: Deno.env.get("DENO_DIR"),
    ghjkDir: ghjkDir.toString(),
    // don't modify system shell configs
    shellsToHook: [],
  });
  await $`${ghjkDir.join("ghjk").toString()} print config`
    .cwd(tmpDir.toString())
    .env(env);
  await $`${ghjkDir.join("ghjk").toString()} ports sync`
    .cwd(tmpDir.toString())
    .env(env);
  /*
  // print the contents of the ghjk dir for debugging purposes
  const ghjkDirLen = ghjkDir.toString().length;
  dbg((await Array.fromAsync(ghjkDir.walk())).map((entry) => [
    entry.isDirectory ? "dir " : entry.isSymlink ? "ln  " : "file",
    entry.path.toString().slice(ghjkDirLen),
  ]));
  */
  {
    const confHome = await ghjkDir.join(".config").ensureDir();
    const fishConfDir = await confHome.join("fish").ensureDir();
    await fishConfDir.join("config.fish").createSymlinkTo(
      ghjkDir.join("env.fish").toString(),
    );
    env["XDG_CONFIG_HOME"] = confHome.toString();
  }
  for (const ePoint of ePoints) {
    let cmd = $.raw`${ePoint.cmd}`
      .cwd(tmpDir.toString())
      .env(env);
    if (ePoint.stdin) {
      cmd = cmd.stdinText(ePoint.stdin);
    }
    await cmd;
  }
  await tmpDir.remove({ recursive: true });
}
