import { dockerE2eTest } from "./utils.ts";

// order tests by download size to make failed runs less expensive
await dockerE2eTest([
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
  // 77 meg +
  {
    name: "asdf-cmake",
    imports: `import port from "$ghjk/ports/asdf.ts"`,
    confFn: `async () => {
  port({
    pluginRepo: "https://github.com/asdf-community/asdf-cmake",
    installType: "version",
  });
    }`,
    ePoint: `cmake --version`,
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
