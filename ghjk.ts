export { ghjk } from "./mod.ts";
import * as ghjk from "./mod.ts";
import act from "./ports/act.ts";
import protoc from "./ports/protoc.ts";
import pipi from "./ports/pipi.ts";

ghjk
  .task("ha")
  .run(async () => {
    await ghjk.$`echo hey`;
  });

ghjk
  .task2("hello")
  .action(async () => {
    await ghjk.$`echo haii`;
  });

// these are just for quick testing
ghjk.install();

// these are used for developing ghjk
ghjk.install(
  // act(),
  // ...pipi({ packageName: "pre-commit" }),
);

export const secureConfig = ghjk.secureConfig({
  allowedPortDeps: [...ghjk.stdDeps({ enableRuntimes: true })],
});
