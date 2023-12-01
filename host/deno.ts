//! this loads the ghjk.ts module and provides a program for it

const mod = await import(Deno.args[0]);
console.log(JSON.stringify(mod));
