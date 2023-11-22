import { dbg, spawn, spawnOutput } from "./core/utils.ts";

// await Deno.mkdir(
//   "/home/asdf/.local/share/ghjk/envs/.home.asdf.Source.ecma.ghjk/installs/node/v9.9.0",
//   { recursive: true },
// );

const fullOut = await spawnOutput([
  "git",
  "ls-remote",
  "--refs",
  "--tags",
  "https://github.com/wasmedge/wasmedge",
]);
console.log(fullOut);
const cutUp = fullOut
  .split("\n")
  .filter((str) => str.length > 0)
  .map((line) => line.split("/")[2]);
console.log(cutUp);
// const deduped = [...new Set(cutUp).keys()];
const deduped = cutUp.filter((str) => str.match(/^\d+.\d+.\d+/));
console.log(deduped);
const hyphenated = deduped.map((ver) => ver.match(/-/) ? ver : `${ver}X`);
console.log("hyphenated", hyphenated);
const sorted = hyphenated.sort((a, b) =>
  a.localeCompare(b, undefined, { numeric: true })
);
console.log("sorted", sorted);
const dehyphenated = sorted.map((ver) => ver.replace(/X$/, ""));

console.log(dehyphenated);

// await spawn(["tar", "--help"], {
//   pipeInput: "RUN echo heyya",
// });

const b = () => {
  console.log("calling b");
  return "b";
};
const a = "a" ?? b();
