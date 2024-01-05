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
    env: { STUFF: "stuffier" },
    async fn({ $ }) {
      await $`echo $STUFF;
      protoc --version;
      `;
    },
  });

ghjk
  .task("ho", {
    dependsOn: ["ha"],
    async fn({ $ }) {
      await $`echo ho`;
    },
  });

ghjk
  .task("hum", {
    dependsOn: ["ho"],
    async fn({ $ }) {
      await $`echo hum`;
    },
  });

ghjk
  .task("hii", {
    dependsOn: ["hum"],
    async fn({ $ }) {
      await $`echo haii`;
    },
  });

ghjk
  .task("hey", {
    dependsOn: ["hii", "ho"],
    async fn({ $ }) {
      await $`echo hey`;
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
