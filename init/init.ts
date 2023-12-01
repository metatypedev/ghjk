//! this loads the ghjk.ts module and provides a program for it

const log = console.log;
console.log = (...args) => {
  log("[ghjk.ts]", ...args);
};
const mod = await import(Deno.args[0]);
console.log = log;
mod.ghjk.runCli(Deno.args.slice(1), mod.options);
