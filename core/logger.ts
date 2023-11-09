import { log } from "../deps/common.ts";

export default function logger() {
  return log.getLogger(self.name ?? "ghjk");
}
