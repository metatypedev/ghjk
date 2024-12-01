//! Import this as a side effect for a mock the Ghjk object.
//! Useful to sanity check code that relies on the Ghjk extension.

import { Ghjk } from "./runtime.js";

const bb = new Map();
Object.assign(Ghjk, {
  callbacks: {
    set: (key: string) => key,
  },
  hostcall: () => Promise.resolve({}),
  blackboard: {
    set: (key: string, value: any) => {
      const old = bb.get(key);
      bb.set(key, value);
      return old;
    },
    get: (key: string) => bb.get(key),
  },
});
