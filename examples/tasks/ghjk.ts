export { sophon } from "@ghjk/ts/hack.ts";
import { logger, task } from "@ghjk/ts/hack.ts";
import * as ports from "@ghjk/ports_wip";

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

task(function thisOneIsNotAnon() {
  logger().info("the function name is used");
});

task("hey", {
  dependsOn: ["hii", "ho", anon],
  fn: () => logger().info(`hey`),
});
