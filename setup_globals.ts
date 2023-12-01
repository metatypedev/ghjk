import type { GhjkConfig } from "./modules/ports/mod.ts";

declare global {
  interface Window {
    ghjk: GhjkConfig;
  }
}

self.ghjk = {
  plugs: new Map(),
  installs: [],
};
