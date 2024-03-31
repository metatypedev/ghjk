export { ghjk } from "./mod.ts";
import { env, install, stdSecureConfig } from "./mod.ts";
import * as ports from "./ports/mod.ts";

// these are just for quick testing
install();

// these are used for developing ghjk
install(
  ports.act(),
  ports.pipi({ packageName: "pre-commit" })[0],
  ports.cpy_bs({ releaseTag: "20231002" }),
);

env("test")
  .install(ports.protoc());

export const secureConfig = stdSecureConfig({
  enableRuntimes: true,
  defaultBaseEnv: "test",
});
