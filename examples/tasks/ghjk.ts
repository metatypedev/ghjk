export { sophon } from "../../hack.ts";
import { logger, task } from "../../hack.ts";
import * as ports from "../../ports/mod.ts";

task("greet", async ($, { argv: [name] }) => {
  await $`echo Hello ${name}!`;
});

const ha = task({
  name: "ha",
  installs: [ports.jq_ghrel()],
  vars: { STUFF: "stuffier" },
  async fn($) {
    await $`echo $STUFF;
      jq --version;
      `;
  },
});

task("ho", {
  dependsOn: [ha],
  fn: () => logger().info(`ho`),
});

task("hii", {
  // task `dependsOn` declaration is order-independent
  dependsOn: ["hum"],
  fn: () => logger().info(`haii`),
});

task("hum", {
  dependsOn: ["ho"],
  fn: () => logger().info(`hum`),
});

// not all tasks need to be named
// but anon tasks can't be accessed from the CLI
const anon = task(() => logger().info("anon"));

task("hey", {
  dependsOn: ["hii", "ho", anon],
  fn: () => logger().info(`hey`),
});
