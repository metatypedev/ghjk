export { ghjk } from "../../mod.ts";
import { install } from "../../mod.ts";
import * as ports from "../../ports/mod.ts";

install(
  ports.asdf({
    pluginRepo: "https://github.com/asdf-community/asdf-cmake",
    installType: "version",
    version: "3.29.1",
  }),
);
