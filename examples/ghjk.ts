import { run, rust } from "../mod.ts";

/*

Custom commands

Alternative to make?

bash({
    script: `
        ls

    `
})

regex for general lockfile

ghjk.run.ts

wasm_edge
poetry i
pnpm i

task(`


`, {with: ["rust"]});


github action

mold({
    if: Deno.build.os === "Macos"
})


test install

*/

rust({
  version: "1.55.0",
});

rust({
  version: "nightly",
  name: "nrust",
});

await run();
