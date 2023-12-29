export { ghjk } from "./mod.ts";
import * as ghjk from "./mod.ts";
import act from "./ports/act.ts";
import protoc from "./ports/protoc.ts";
import pipi from "./ports/pipi.ts";

ghjk
  .task("ha", {
    installs: [
      protoc(),
    ],
    env: { STUFF: "hello" },
    async fn({ $ }) {
      await $`echo $STUFFY;
      protoc --version
      `;
    },
  });

// these are just for quick testing
ghjk.install();

// these are used for developing ghjk
ghjk.install(
  act(),
  ...pipi({ packageName: "pre-commit" }),
);

export const secureConfig = ghjk.secureConfig({
  allowedPortDeps: [...ghjk.stdDeps({ enableRuntimes: true })],
});
