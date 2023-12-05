//! Setup ghjk for the CWD

import { install } from "./install/mod.ts";

if (import.meta.main) {
  await install();
} else {
  throw new Error(
    "unexpected ctx: if you want to access the ghjk installer, import `install` from ./install/mod.ts",
  );
}
