import { log } from "./deps/common.ts";
import { ConsoleErrHandler } from "./core/logger.ts";

log.setup({
  handlers: {
    console: new ConsoleErrHandler("NOTSET"),
  },

  loggers: {
    default: {
      level: "DEBUG",
      handlers: ["console"],
    },
    ghjk: {
      level: "DEBUG",
      handlers: ["console"],
    },
  },
});
