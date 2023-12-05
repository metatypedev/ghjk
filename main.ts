#! /usr/bin/env -S deno run --unstable-worker-options -A  

import { main } from "./host/mod.ts";

if (import.meta.main) {
  await main();
} else {
  throw new Error(
    "unexpected ctx: if you want to run the ghjk cli, import `main` from ./host/mod.ts",
  );
}
