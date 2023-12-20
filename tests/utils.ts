import { defaultInstallArgs, install } from "../install/mod.ts";
import type { InstallConfigFat } from "../modules/ports/types.ts";
import { std_url } from "../deps/common.ts";
import { $, dbg, importRaw } from "../utils/mod.ts";

export type E2eTestCase = {
  name: string;
  installConf: InstallConfigFat | InstallConfigFat[];
  envs?: Record<string, string>;
  ePoint: string;
};

export async function localE2eTest(testCase: E2eTestCase) {
  const { envs: testEnvs, installConf, ePoint } = testCase;
  const tmpDir = $.path(
    await Deno.makeTempDir({
      prefix: "ghjk_le2e_",
    }),
  );

  const ghjkDir = await tmpDir.join("ghjk").ensureDir();
  await install({
    ...defaultInstallArgs,
    skipExecInstall: false,
    ghjkExecInstallDir: ghjkDir.toString(),
    ghjkDir: ghjkDir.toString(),
    shellsToHook: [],
  });
  const installConfArray = Array.isArray(installConf)
    ? installConf
    : [installConf];
  await tmpDir.join("ghjk.ts").writeText(
    `
export { ghjk } from "$ghjk/mod.ts";
import { install } from "$ghjk/mod.ts";
const confStr = \`
${JSON.stringify(installConfArray)}
\`;
const confObj = JSON.parse(confStr);
install(...confObj)
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
  {
    const confHome = await ghjkDir.join(".config").ensureDir();
    const fishConfDir = await confHome.join("fish").ensureDir();
    await fishConfDir.join("config.fish").createSymlinkTo(
      ghjkDir.join("env.fish").toString(),
    );
    env["XDG_CONFIG_HOME"] = confHome.toString();
  }
  await $`${ghjkDir.join("ghjk").toString()} print config`
    .cwd(tmpDir.toString())
    .env(env);
  await $`${ghjkDir.join("ghjk").toString()} ports sync`
    .cwd(tmpDir.toString())
    .env(env);

  // print the contents of the ghjk dir for debugging purposes
  const ghjkDirLen = ghjkDir.toString().length;
  dbg((await Array.fromAsync(ghjkDir.walk())).map((entry) => [
    entry.isDirectory ? "dir " : entry.isSymlink ? "ln  " : "file",
    entry.path.toString().slice(ghjkDirLen),
  ]));

  for (const shell of ["bash -c", "fish -c", "zsh -c"]) {
    await $.raw`env ${shell} '${ePoint}'`
      .cwd(tmpDir.toString())
      .env(env);
  }
  await tmpDir.remove({ recursive: true });
}

const dockerCmd = (Deno.env.get("DOCKER_CMD") ?? "docker").split(/\s/);
const dFileTemplate = await importRaw(import.meta.resolve("./test.Dockerfile"));
const templateStrings = {
  addConfig: `#{{CMD_ADD_CONFIG}}`,
};

export async function dockerE2eTest(testCase: E2eTestCase) {
  const { name, envs: testEnvs, ePoint, installConf } = testCase;
  const tag = `ghjk_e2e_${name}`;
  const env = {
    ...testEnvs,
  };
  const installConfArray = Array.isArray(installConf)
    ? installConf
    : [installConf];
  const devGhjkPath = import.meta.resolve("../");
  const serializedConf = JSON.stringify(
    installConfArray,
    (_, val) =>
      typeof val == "string" ? val.replace(devGhjkPath, "file://$ghjk/") : val,
  );
  const configFile = `
export { ghjk } from "$ghjk/mod.ts";
import { install } from "$ghjk/mod.ts";
const confStr = \\\`
${serializedConf}
\\\`;
const confObj = JSON.parse(confStr);
install(...confObj)
`.replaceAll("$ghjk", "/ghjk");

  const dFile = dbg(dFileTemplate.replaceAll(
    templateStrings.addConfig,
    configFile,
  ));
  await $
    .raw`${dockerCmd} buildx build --tag '${tag}' --network=host --output type=docker -f- .`
    .env(env)
    .stdinText(dFile);
  for (const shell of ["bash", "fish", "zsh"]) {
    await $
      .raw`${dockerCmd} run --rm ${
      Object.entries(env).map(([key, val]) => ["-e", `${key}=${val}`])
        .flat()
    } ${tag} ${shell} -c '${ePoint}'`
      .env(env);
  }
  await $
    .raw`${dockerCmd} rmi '${tag}'`
    .env(env);
}
