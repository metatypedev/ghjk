import { spawn } from "../cli/utils.ts";
// import node from "../plugs/node.ts";

type TestCase = {
  name: string;
  imports: string;
  confFn: string | (() => Promise<void>);
  envs?: Record<string, string>;
  ePoint: string;
};

async function dockerTest(cases: TestCase[]) {
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
${imports.replaceAll("$ghjk", "/ghjk/")}

await (${confFn.toString()})()`;

      const dFile = dFileTemplate.replaceAll(
        templateStrings.addConfig,
        configFile,
      );
      await spawn([
        ...dockerCmd,
        "buildx",
        "build",
        "-t",
        tag,
        "-f-",
        ".",
      ], { env, pipeInput: dFile });
      await spawn([
        ...dockerCmd,
        "run",
        "--rm",
        "-v",
        ".:/ghjk:ro",
        ...Object.entries(env).map(([key, val]) => ["-e", `${key}=${val}`])
          .flat(),
        tag,
        "bash",
        "-c",
        "-i",
        ...ePoint.split(/\s/),
      ], { env });
      await spawn([
        ...dockerCmd,
        "rmi",
        tag,
      ]);
    });
  }
}

await dockerTest([{
  name: "a",
  imports: `import node from "$ghjk/plugs/node.ts"`,
  confFn: `async () => {
    node({ version: "lts" });
  }`,
  ePoint: `node --version`,
}]);
