import "../setup_logger.ts";
import { spawn } from "../utils/mod.ts";

export type DockerE2eTestCase = {
  name: string;
  imports: string;
  confFn: string | (() => Promise<void>);
  envs?: Record<string, string>;
  ePoint: string;
};

export async function dockerE2eTest(cases: DockerE2eTestCase[]) {
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
    Deno.test(`dockerTest - ${name}`, async () => {
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
