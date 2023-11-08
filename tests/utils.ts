import { runOrExit } from "../cli/utils.ts";
import { node } from "../tools/node.ts";

type TestCase = {
  name: string;
  imports: string;
  confFn: () => Promise<void>;
  envs?: Record<string, string>;
  epoint: string;
};


async function dockerTest(cases: TestCase[]) {
  // const socket = Deno.env.get("DOCKER_SOCK") ?? "/var/run/docker.sock";
  // const docker = new Docker(socket);
  const dockerCmd = (Deno.env.get("DOCKER_CMD") ?? "docker").split(/\s/);
  const dfileTemplate = await Deno.readTextFile(
    import.meta.resolve("./test.Dockerfile").slice(6),
  );
  const templateStrings = {
    addConfig: `#{{CMD_ADD_CONFIG}}`,
  };
  const defaultEnvs: Record<string, string> = {};

  for (const { name, envs: testEnvs, confFn, epoint, imports } of cases) {
    Deno.test(`dockerTest - ${name}`, async () => {
      const tag = `ghjk_test_${name}`;
      const env = {
        ...defaultEnvs,
        ...testEnvs,
      };
      const configFile = `export { ghjk } from "/ghjk/cli/mod.ts";
${imports.replaceAll("$ghjk", "/ghjk/")}

await (${confFn.toString()})()`;

      const dFile = dfileTemplate.replaceAll(
        templateStrings.addConfig,
        configFile,
      );
      await runOrExit([
        ...dockerCmd,
        "buildx",
        "build",
        "-t",
        tag,
        "-f-",
        ".",
      ], { env, pipeInput: dFile });
      await runOrExit([
        ...dockerCmd,
        "run",
        "--rm",
        "-v",
        ".:/ghjk:ro",
        ...Object.entries(env).map(([key, val]) => ["-e", `${key}=${val}`])
          .flat(),
        tag,
        ...epoint.split(/\s/),
      ], { env });
      await runOrExit([
        ...dockerCmd,
        "rmi",
        tag,
      ]);
    });
  }
}

await dockerTest([{
  name: "a",
  imports: `import { node } from "$ghjk/tools/node.ts"`,
  confFn: async () => {
    // node({ version: "lts" });
  },
  epoint: `echo yes`,
},{
  name: "b",
  imports: `import { node } from "$ghjk/tools/node.ts"`,
  confFn: async () => {
    // node({ version: "lts" });
  },
  epoint: `echo yes`,
},
]);
