// const { core } = Deno[Deno.internal];
const { core } = Deno;
const { ops } = core;
// const fastops = core.ensureFastOps(); // TODO: investigate

// NOTE: use the following import if ever switching to snaphsots
// import * as ops from "ext:core/ops";

function getOp(name) {
  // Note: always get the op right away.
  // the core.ops object is a proxy
  // that retrieves the named op
  // when requested i.e. not a
  // hashmap prepopulated by the ops.
  // If we don't get the op now, the
  // proxy behvior won't be avail later at runtime
  const op = ops[name];
  if (!op) {
    throw Error(`op: ${name} not found`);
  }
  return op;
}

/**
 * @type {import('./runtime.d.ts').GhjkNs}
 */
const Ghjk = {
  blackboard: {
    get: getOp("op_get_blackboard"),
    set: getOp("op_set_blackboard"),
  },
};

globalThis.Ghjk = Ghjk;
