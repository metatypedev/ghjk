export { ghjk } from "../mod.ts";
import { $, install } from "../mod.ts";
import node from "../ports/node.ts";
import pnpm from "../ports/pnpm.ts";

install(
  node({
    version: "v" +
      await $.path(import.meta.resolve("./.node-version")).readText(),
  }),
  pnpm(),
);
