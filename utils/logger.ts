import {
  std_fmt_colors,
  std_log,
  std_log_levels,
  std_path,
  std_url,
} from "../deps/common.ts";

// TODO: consult GHJK_LOG variable
export default function logger(
  name: ImportMeta | string = self.name,
) {
  if (typeof name === "object") {
    name = std_url.basename(name.url);
    name = name.replace(std_path.extname(name), "");
  }
  return std_log.getLogger(name);
}

function formatter(lr: std_log.LogRecord) {
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

export function setup(handler = new ConsoleErrHandler("NOTSET")) {
  const panicLevelName = Deno.env.get("GHJK_LOG_PANIC_LEVEL");
  if (panicLevelName) {
    handler = new TestConsoleErrHandler(
      std_log_levels.getLevelByName(
        panicLevelName.toUpperCase() as std_log_levels.LevelName,
      ),
      "NOTSET",
    );
  }
  std_log.setup({
    handlers: {
      console: handler,
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

export class ConsoleErrHandler extends std_log.handlers.BaseHandler {
  constructor(
    levelName: std_log.LevelName,
    options: std_log.HandlerOptions = { formatter },
  ) {
    super(levelName, options);
  }
  override log(msg: string): void {
    console.error(msg);
  }
  override format(logRecord: std_log.LogRecord): string {
    let msg = super.format(logRecord);

    switch (logRecord.level) {
      case std_log.LogLevels.INFO:
        msg = std_fmt_colors.green(msg);
        break;
      case std_log.LogLevels.WARNING:
        msg = std_fmt_colors.yellow(msg);
        break;
      case std_log.LogLevels.ERROR:
        msg = std_fmt_colors.red(msg);
        break;
      case std_log.LogLevels.CRITICAL:
        msg = std_fmt_colors.bold(std_fmt_colors.red(msg));
        break;
      case std_log.LogLevels.DEBUG:
        msg = std_fmt_colors.dim(msg);
        break;
      default:
        break;
    }

    return msg;
  }
}

export class TestConsoleErrHandler extends ConsoleErrHandler {
  constructor(
    public throwLevel: number,
    levelName: std_log.LevelName,
    options: std_log.HandlerOptions = { formatter },
  ) {
    super(levelName, options);
  }

  handle(lr: std_log.LogRecord): void {
    if (lr.level >= this.throwLevel) {
      throw new Error(`detected ${lr.levelName} log record:`, { cause: lr });
    }
    super.handle(lr);
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
