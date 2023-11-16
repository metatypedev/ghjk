import { spawn } from "./cli/utils.ts";

// await Deno.mkdir(
//   "/home/asdf/.local/share/ghjk/envs/.home.asdf.Source.ecma.ghjk/installs/node/v9.9.0",
//   { recursive: true },
// );

await spawn(["tar", "--help"], {
  pipeInput: "RUN echo heyya",
});

const b = () => {
  console.log("calling b");
  return "b";
};
const a = "a" ?? b();
