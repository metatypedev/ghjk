export { sophon } from "./hack.ts";
import { config, install } from "./hack.ts";
import * as ports from "./ports/mod.ts";

config({
  defaultBaseEnv: "test",
  enableRuntimes: true,
});

// these are just for quick testing
install();

// these are used for developing ghjk
install(
  ports.act(),
  ports.pipi({ packageName: "pre-commit" })[0],
  ports.cpy_bs(),
);
