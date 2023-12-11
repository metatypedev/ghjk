import "../setup_logger.ts";
import { defaultInstallArgs, install } from "../install/mod.ts";
import { std_url } from "../deps/common.ts";
import { $, spawn } from "../utils/mod.ts";
import logger from "../utils/logger.ts";

export type E2eTestCase = {
  name: string;
  imports: string;
  confFn: string | (() => Promise<void>);
  envs?: Record<string, string>;
  ePoint: string;
};

export function localE2eTest(cases: E2eTestCase[]) {
  const defaultEnvs: Record<string, string> = {};
  for (const { name, envs: testEnvs, confFn, ePoint, imports } of cases) {
    Deno.test(`localE2eTest - ${name}`, async () => {
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
      await tmpDir.join("ghjk.ts").writeText(
        `export { ghjk } from "$ghjk/mod.ts";
${imports}

await (${confFn.toString()})()`
          .replaceAll(
            "$ghjk",
            std_url.dirname(import.meta.resolve("../mod.ts")).href,
          ),
      );
      const env: Record<string, string> = {
        ...defaultEnvs,
        ...testEnvs,
        BASH_ENV: `${ghjkDir.toString()}/env.sh`,
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
      await $`${ghjkDir.join("ghjk").toString()} config`
        .cwd(tmpDir.toString())
        .env(env);
      await $`${ghjkDir.join("ghjk").toString()} ports sync`
        .cwd(tmpDir.toString())
        .env(env);
      const ghjkDirLen = ghjkDir.toString().length;
      for await (const entry of ghjkDir.walk()) {
        logger().debug(entry.path.toString().slice(ghjkDirLen), {
          ty: entry.isDirectory ? "dir" : entry.isSymlink ? "link" : "file",
        });
      }
      for (const shell of ["bash -c", "fish -c", "zsh -c"]) {
        await $.raw`env ${shell} '${ePoint}'`
          .cwd(tmpDir.toString())
          .env(env);
      }
      await tmpDir.remove({ recursive: true });
    });
  }
}

export async function dockerE2eTest(cases: E2eTestCase[]) {
  // const socket = Deno.env.get("DOCKER_SOCK") ?? "/var/run/docker.sock";
  // const docker = new Docker(socket);
  const dockerCmd = (Deno.env.get("DOCKER_CMD") ?? "docker").split(/\s/);
  const dFileTemplate = await Deno.readTextFile(
    import.meta.resolve("./test.Dockerfile").slice(6),
  );
  const templateStrings = {
    addConfig: `#{{CMD_ADD_CONFIG}}`,
  };
  const defaultEnvs: Record<string, string> = {};

  for (const { name, envs: testEnvs, confFn, ePoint, imports } of cases) {
    Deno.test(`dockerE2eTest - ${name}`, async () => {
      const tag = `ghjk_test_${name}`;
      const env = {
        ...defaultEnvs,
        ...testEnvs,
      };
      const configFile = `export { ghjk } from "/ghjk/mod.ts";
${imports.replaceAll("$ghjk", "/ghjk")}

await (${confFn.toString()})()`;

      const dFile = dFileTemplate.replaceAll(
        templateStrings.addConfig,
        configFile,
      );
      await spawn([
        ...dockerCmd,
        "buildx",
        "build",
        "--tag",
        tag,
        "--network=host",
        // add to images list
        "--output",
        "type=docker",
        "-f-",
        ".",
      ], { env, pipeInput: dFile });
      for (const shell of ["bash", "fish", "zsh"]) {
        await spawn([
          ...dockerCmd,
          "run",
          "--rm",
          ...Object.entries(env).map(([key, val]) => ["-e", `${key}=${val}`])
            .flat(),
          tag,
          shell,
          "-c",
          ePoint,
        ], { env });
      }
      await spawn([
        ...dockerCmd,
        "rmi",
        tag,
      ]);
    });
  }
}
