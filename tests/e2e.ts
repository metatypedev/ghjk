import "../setup_logger.ts";
import { spawn } from "../utils/mod.ts";

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
      for (const shell of ["bash", "fish"]) {
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

// order tests by download size to make failed runs less expensive
await dockerTest([
  // 3 megs
  {
    name: "protoc",
    imports: `import port from "$ghjk/ports/protoc.ts"`,
    confFn: `async () => {
    port({ });
  }`,
    ePoint: `protoc --version`,
  },
  // 6 megs
  {
    name: "ruff",
    imports: `import port from "$ghjk/ports/ruff.ts"`,
    confFn: `async () => {
    port({ });
  }`,
    ePoint: `ruff --version`,
  },
  // 7 megs
  {
    name: "whiz",
    imports: `import port from "$ghjk/ports/whiz.ts"`,
    confFn: `async () => {
    port({ });
  }`,
    ePoint: `whiz --version`,
  },
  // 7 megs
  {
    name: "act",
    imports: `import port from "$ghjk/ports/act.ts"`,
    confFn: `async () => {
    port({ });
  }`,
    ePoint: `act --version`,
  },
  // 7 megs
  {
    name: "cargo-binstall",
    imports: `import port from "$ghjk/ports/cargo-binstall.ts"`,
    confFn: `async () => {
    port({ });
  }`,
    ePoint: `cargo-binstall -V`,
  },
  // 8 megs
  {
    name: "mold",
    imports: `import port from "$ghjk/ports/mold.ts"`,
    confFn: `async () => {
    port({ });
  }`,
    ePoint: `mold -V`,
  },
  // 16 megs
  {
    name: "wasmedge",
    imports: `import port from "$ghjk/ports/wasmedge.ts"`,
    confFn: `async () => {
    port({ });
  }`,
    ePoint: `wasmedge --version`,
  },
  // cargo binstall +7 megs
  {
    name: "cargo-insta",
    imports: `import port from "$ghjk/ports/cargo-insta.ts"`,
    confFn: `async () => {
    port({ });
  }`,
    ePoint: `cargo-insta -V`,
  },
  // cargo binsatll 13 megs
  {
    name: "wasm-tools",
    imports: `import port from "$ghjk/ports/wasm-tools.ts"`,
    confFn: `async () => {
    port({ });
  }`,
    ePoint: `wasm-tools -V`,
  },
  // 25 megs
  {
    name: "node",
    imports: `import port from "$ghjk/ports/node.ts"`,
    confFn: `async () => {
    port({ });
  }`,
    ePoint: `node --version`,
  },
  // cargo-binstall + 22 megs
  {
    name: "wasm-opt",
    imports: `import port from "$ghjk/ports/wasm-opt.ts"`,
    confFn: `async () => {
    port({ });
  }`,
    ePoint: `wasm-opt --version`,
  },
  // 42 megs
  {
    name: "pnpm",
    imports: `import port from "$ghjk/ports/earthly.ts"`,
    confFn: `async () => {
    port({ });
  }`,
    ePoint: `earthly --version`,
  },
  // 56 megs
  {
    name: "pnpm",
    imports: `import port from "$ghjk/ports/pnpm.ts"`,
    confFn: `async () => {
    port({ });
  }`,
    ePoint: `pnpm --version`,
  },
  // node + more megs
  {
    name: "jco",
    imports: `import port from "$ghjk/ports/jco.ts"`,
    confFn: `async () => {
    port({ });
  }`,
    ePoint: `jco --version`,
  },
  // big
  {
    name: "asdf-zig",
    imports: `import port from "$ghjk/ports/asdf.ts"`,
    confFn: `async () => {
  port({
    portRepo: "https://github.com/asdf-community/asdf-zig",
    installType: "version",
  });
    }`,
    ePoint: `zig version`,
  },
  // // big
  // {
  //   name: "asdf-python",
  //   imports: `import port from "$ghjk/ports/asdf.ts"`,
  //   confFn: `async () => {
  // port({
  //   portRepo: "https://github.com/asdf-community/asdf-python",
  //   installType: "version",
  // });
  //   }`,
  //   ePoint: `python --version`,
  // },
]);
