import { dockerE2eTest, E2eTestCase, localE2eTest } from "./utils.ts";

// order tests by download size to make failed runs less expensive
const cases: E2eTestCase[] = [
  ...(Deno.build.os == "linux"
    ? [
      // 8 megs
      {
        name: "mold",
        imports: `import port from "$ghjk/ports/mold.ts"`,
        confFn: `async () => {
    install(port());
  }`,
        ePoint: `mold -V`,
      },
    ]
    : []),

  // 3 megs
  {
    name: "protoc",
    imports: `import port from "$ghjk/ports/protoc.ts"`,
    confFn: `async () => {
    install(port());
  }`,
    ePoint: `protoc --version`,
  },
  // 6 megs
  {
    name: "ruff",
    imports: `import port from "$ghjk/ports/ruff.ts"`,
    confFn: `async () => {
    install(port());
  }`,
    ePoint: `ruff --version`,
  },
  // 7 megs
  {
    name: "whiz",
    imports: `import port from "$ghjk/ports/whiz.ts"`,
    confFn: `async () => {
    install(port());
  }`,
    ePoint: `whiz --version`,
  },
  // 7 megs
  {
    name: "act",
    imports: `import port from "$ghjk/ports/act.ts"`,
    confFn: `async () => {
    install(port());
  }`,
    ePoint: `act --version`,
  },
  // 7 megs
  {
    name: "cargo-binstall",
    imports: `import port from "$ghjk/ports/cargo-binstall.ts"`,
    confFn: `async () => {
    install(port());
  }`,
    ePoint: `cargo-binstall -V`,
  },
  // 16 megs
  {
    name: "wasmedge",
    imports: `import port from "$ghjk/ports/wasmedge.ts"`,
    confFn: `async () => {
    install(port());
  }`,
    ePoint: `wasmedge --version`,
  },
  // cargo binstall +7 megs
  {
    name: "cargo-insta",
    imports: `import port from "$ghjk/ports/cargo-insta.ts"`,
    confFn: `async () => {
    install(port());
  }`,
    ePoint: `cargo-insta -V`,
  },
  // cargo binsatll 13 megs
  {
    name: "wasm-tools",
    imports: `import port from "$ghjk/ports/wasm-tools.ts"`,
    confFn: `async () => {
    install(port());
  }`,
    ePoint: `wasm-tools -V`,
  },
  // 25 megs
  {
    name: "node",
    imports: `import port from "$ghjk/ports/node.ts"`,
    confFn: `async () => {
    install(port());
  }`,
    ePoint: `node --version`,
  },
  // cargo-binstall + 22 megs
  {
    name: "wasm-opt",
    imports: `import port from "$ghjk/ports/wasm-opt.ts"`,
    confFn: `async () => {
    install(port());
  }`,
    ePoint: `wasm-opt --version`,
  },
  // 42 megs
  {
    name: "earthly",
    imports: `import port from "$ghjk/ports/earthly.ts"`,
    confFn: `async () => {
    install(port());
  }`,
    ePoint: `earthly --version`,
  },
  // 56 megs
  {
    name: "pnpm",
    imports: `import port from "$ghjk/ports/pnpm.ts"`,
    confFn: `async () => {
    install(port());
  }`,
    ePoint: `pnpm --version`,
  },
  // node + more megs
  {
    name: "jco",
    imports: `import port from "$ghjk/ports/jco.ts"`,
    confFn: `async () => {
    install(...port());
  }`,
    ePoint: `jco --version`,
  },
  // 77 meg +
  {
    name: "asdf-cmake",
    imports: `import port from "$ghjk/ports/asdf.ts"`,
    confFn: `async () => {
  install(port({
    pluginRepo: "https://github.com/asdf-community/asdf-cmake",
    installType: "version",
  }));
    }`,
    ePoint: `cmake --version`,
  },
  // big
  {
    name: "python_bs",
    imports: `import port from "$ghjk/ports/python_bs.ts"`,
    confFn: `async () => {
      install(port());
    }`,
    ePoint: `python3 --version`,
  },
];

if (Deno.env.get("GHJK_E2E_TYPE") == "both") {
  localE2eTest(cases);
  await dockerE2eTest(cases);
} else if (Deno.env.get("GHJK_TEST_E2E_TYPE") == "local") {
  localE2eTest(cases);
} else if (
  Deno.env.get("GHJK_TEST_E2E_TYPE") == "docker" ||
  !Deno.env.has("GHJK_TEST_E2E_TYPE")
) {
  await dockerE2eTest(cases);
} else {
  throw new Error(
    `unexpected GHJK_TEST_E2E_TYPE: ${Deno.env.get("GHJK_TEST_E2E_TYPE")}`,
  );
}
