import { runOrExit } from "./cli/utils.ts";

await runOrExit(["docker", "buildx", "build", "-t", "test", "-"], {
  pipeInput: "RUN echo heyya",
});
