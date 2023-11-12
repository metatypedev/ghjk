import { spawn } from "./cli/utils.ts";

await spawn(["tar", "--help"], {
  pipeInput: "RUN echo heyya",
});

const b = () => {
  console.log("calling b");
  return "b";
};
const a = "a" ?? b();
