import { log, std_fmt_colors, std_path, std_url } from "../deps/common.ts";

// TODO: consult GHJK_LOG variable
export default function logger(
  name: ImportMeta | string = self.name,
) {
  if (typeof name === "object") {
    name = std_url.basename(name.url);
    name = name.replace(std_path.extname(name), "");
  }
  return log.getLogger(name);
}

function formatter(lr: log.LogRecord) {
  const loggerName = lr.loggerName !== "default" ? " " + lr.loggerName : "";
  let msg = `[${lr.levelName}${loggerName}] ${lr.msg}`;

  lr.args.forEach((arg, _index) => {
    msg += `, ${
      Deno.inspect(arg, {
        colors: isColorfulTty(),
        depth: 10,
        strAbbreviateSize: 256,
        iterableLimit: 1000,
      })
    }`;
  });

  return msg;
}

export function setup() {
  log.setup({
    handlers: {
      console: new ConsoleErrHandler("NOTSET"),
    },

    loggers: {
      default: {
        level: "DEBUG",
        handlers: ["console"],
      },
      [self.name]: {
        level: "DEBUG",
        handlers: ["console"],
      },
    },
  });
}

export class ConsoleErrHandler extends log.handlers.BaseHandler {
  constructor(
    levelName: log.LevelName,
    options: log.HandlerOptions = { formatter },
  ) {
    super(levelName, options);
  }
  override log(msg: string): void {
    console.error(msg);
  }
  override format(logRecord: log.LogRecord): string {
    let msg = super.format(logRecord);

    switch (logRecord.level) {
      case log.LogLevels.INFO:
        msg = std_fmt_colors.green(msg);
        break;
      case log.LogLevels.WARNING:
        msg = std_fmt_colors.yellow(msg);
        break;
      case log.LogLevels.ERROR:
        msg = std_fmt_colors.red(msg);
        break;
      case log.LogLevels.CRITICAL:
        msg = std_fmt_colors.bold(std_fmt_colors.red(msg));
        break;
      case log.LogLevels.DEBUG:
        msg = std_fmt_colors.dim(msg);
        break;
      default:
        break;
    }

    return msg;
  }
}

let colorEnvFlagSet = false;
Deno.permissions.query({
  name: "env",
  variable: "CLICOLOR_FORCE",
}).then((perm) => {
  if (perm.state == "granted") {
    const val = Deno.env.get("CLICOLOR_FORCE");
    colorEnvFlagSet = !!val && val != "0" && val != "false";
  }
});

export function isColorfulTty(outFile = Deno.stdout) {
  if (colorEnvFlagSet) {
    return true;
  }
  if (Deno.isatty(outFile.rid)) {
    const { columns } = Deno.consoleSize();
    return columns > 0;
  }
  return false;
}
