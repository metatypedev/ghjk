export { ghjk } from "./mod.ts";
import * as ghjk from "./mod.ts";
import * as ports from "./ports/mod.ts";

ghjk
  .task("greet", {
    fn: async ({ $, argv: [name] }) => {
      await $`echo Hello ${name}!`;
    },
  });

const ha = ghjk
  .task("ha", {
    installs: [
      ports.protoc(),
    ],
    envVars: { STUFF: "stuffier" },
    async fn({ $ }) {
      await $`echo $STUFF;
      protoc --version;
      `;
    },
  });

const ho = ghjk
  .task("ho", {
    dependsOn: [ha],
    async fn({ $ }) {
      await $`echo ho`;
    },
  });

const hum = ghjk
  .task("hum", {
    dependsOn: [ho],
    async fn({ $ }) {
      await $`echo hum`;
    },
  });

const hii = ghjk
  .task("hii", {
    dependsOn: [hum],
    async fn({ $ }) {
      await $`echo haii`;
    },
  });

ghjk
  .task("hey", {
    dependsOn: [hii, ho],
    async fn({ $ }) {
      await $`echo hey`;
    },
  });

// these are just for quick testing
ghjk.install();

// these are used for developing ghjk
ghjk.install(
  ports.act(),
  ports.pipi({ packageName: "pre-commit" })[0],
  ports.cpy_bs({ releaseTag: "20231002" }),
);

export const secureConfig = ghjk.secureConfig({
  masterPortDepAllowList: ghjk.stdDeps({ enableRuntimes: true }),
});
