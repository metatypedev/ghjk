import "./setup_globals.ts";
import { spawn } from "../core/utils.ts";

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
      await spawn([
        ...dockerCmd,
        "run",
        "--rm",
        ...Object.entries(env).map(([key, val]) => ["-e", `${key}=${val}`])
          .flat(),
        tag,
        "bash",
        "-c",
        `
        source ~/.bashrc
        init_ghjk
        ${ePoint}
        `,
      ], { env });
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
    imports: `import plug from "$ghjk/plugs/protoc.ts"`,
    confFn: `async () => {
    plug({ });
  }`,
    ePoint: `protoc --version`,
  },
  // 6 megs
  {
    name: "ruff",
    imports: `import plug from "$ghjk/plugs/ruff.ts"`,
    confFn: `async () => {
    plug({ });
  }`,
    ePoint: `ruff --version`,
  },
  // 7 megs
  {
    name: "whiz",
    imports: `import plug from "$ghjk/plugs/whiz.ts"`,
    confFn: `async () => {
    plug({ });
  }`,
    ePoint: `whiz --version`,
  },
  // 7 megs
  {
    name: "act",
    imports: `import plug from "$ghjk/plugs/act.ts"`,
    confFn: `async () => {
    plug({ });
  }`,
    ePoint: `act --version`,
  },
  // 7 megs
  {
    name: "cargo-binstall",
    imports: `import plug from "$ghjk/plugs/cargo-binstall.ts"`,
    confFn: `async () => {
    plug({ });
  }`,
    ePoint: `cargo-binstall -V`,
  },
  // 8 megs
  {
    name: "mold",
    imports: `import plug from "$ghjk/plugs/mold.ts"`,
    confFn: `async () => {
    plug({ });
  }`,
    ePoint: `mold -V`,
  },
  // 16 megs
  {
    name: "wasmedge",
    imports: `import plug from "$ghjk/plugs/wasmedge.ts"`,
    confFn: `async () => {
    plug({ });
  }`,
    ePoint: `wasmedge --version`,
  },
  // cargo binstall +7 megs
  {
    name: "cargo-insta",
    imports: `import plug from "$ghjk/plugs/cargo-insta.ts"`,
    confFn: `async () => {
    plug({ });
  }`,
    ePoint: `cargo-insta -V`,
  },
  // cargo binsatll 13 megs
  {
    name: "wasm-tools",
    imports: `import plug from "$ghjk/plugs/wasm-tools.ts"`,
    confFn: `async () => {
    plug({ });
  }`,
    ePoint: `wasm-tools -V`,
  },
  // 25 megs
  {
    name: "node",
    imports: `import plug from "$ghjk/plugs/node.ts"`,
    confFn: `async () => {
    plug({ });
  }`,
    ePoint: `node --version`,
  },
  // cargo-binstall + 22 megs
  {
    name: "wasm-opt",
    imports: `import plug from "$ghjk/plugs/wasm-opt.ts"`,
    confFn: `async () => {
    plug({ });
  }`,
    ePoint: `wasm-opt --version`,
  },
  // 42 megs
  {
    name: "pnpm",
    imports: `import plug from "$ghjk/plugs/earthly.ts"`,
    confFn: `async () => {
    plug({ });
  }`,
    ePoint: `earthly --version`,
  },
  // 56 megs
  {
    name: "pnpm",
    imports: `import plug from "$ghjk/plugs/pnpm.ts"`,
    confFn: `async () => {
    plug({ });
  }`,
    ePoint: `pnpm --version`,
  },
  // pnpm + more megs
  {
    name: "jco",
    imports: `import plug from "$ghjk/plugs/jco.ts"`,
    confFn: `async () => {
    plug({ });
  }`,
    ePoint: `jco --version`,
  },
  // big
  {
    name: "asdf-zig",
    imports: `import plug from "$ghjk/plugs/asdf.ts"`,
    confFn: `async () => {
  plug({
    plugRepo: "https://github.com/asdf-community/asdf-zig",
    installType: "version",
  });
    }`,
    ePoint: `zig version`,
  },
  // // big
  // {
  //   name: "asdf-python",
  //   imports: `import plug from "$ghjk/plugs/asdf.ts"`,
  //   confFn: `async () => {
  // plug({
  //   plugRepo: "https://github.com/asdf-community/asdf-python",
  //   installType: "version",
  // });
  //   }`,
  //   ePoint: `python --version`,
  // },
]);
