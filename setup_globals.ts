import type { GhjkConfig } from "./core/mod.ts";

declare global {
  interface Window {
    ghjk: GhjkConfig;
  }
}

self.ghjk = {
  plugs: new Map(),
  installs: [],
};
