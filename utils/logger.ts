import {
  std_fmt_colors,
  std_log,
  std_log_levels,
  std_url,
  zod,
} from "../deps/common.ts";

const defaultLogLevel = "INFO" as const;

// This parses the GHJK_LOG env var
function confFromEnv() {
  const loggerConfs = { "": defaultLogLevel } as Record<
    string,
    zod.infer<typeof levelValidator>
  >;
  const confStr = Deno.env.get("GHJK_LOG");
  if (!confStr) {
    return loggerConfs;
  }
  const levelValidator = zod.enum(
    ["NOTSET", "DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"],
    {
      description: "Log levels",
    },
  );
  let defaultLevel = levelValidator.parse(defaultLogLevel);
  const confs = confStr.toUpperCase().split(",");
  // configure specific named loggers
  for (const confSection of confs) {
    const [left, right] = confSection.split("=");
    // this is a plain level name, thus configuring the default logger
    if (!right) {
      defaultLevel = levelValidator.parse(left);
    } else {
      loggerConfs[left] = levelValidator.parse(right);
    }
  }
  loggerConfs[""] = defaultLevel;
  return loggerConfs;
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
const loggers = new Map<string, std_log.Logger>();
const loggerLevelsConf = confFromEnv();

const panicLevelName = Deno.env.get("GHJK_LOG_PANIC_LEVEL");
const consoleHandler = panicLevelName
  ? new TestConsoleErrHandler(
    std_log_levels.getLevelByName(
      panicLevelName.toUpperCase() as std_log_levels.LevelName,
    ),
    "NOTSET",
  )
  : new ConsoleErrHandler("NOTSET");

// TODO: consult GHJK_LOG variable
export default function logger(
  name: ImportMeta | string = self.name,
) {
  if (typeof name === "object") {
    const baseName = std_url.basename(name.url);
    const dirName = std_url.basename(std_url.dirname(name.url));
    name = `${dirName}/${baseName}`;
  }
  let logger = loggers.get(name);
  if (!logger) {
    const level = loggerLevelsConf[name] ?? loggerLevelsConf[""];
    logger = new std_log.Logger(name, level, {
      handlers: [consoleHandler],
    });
  }
  return logger;
}

export function setup() {
  const defaultLogger = new std_log.Logger("default", loggerLevelsConf[""], {
    handlers: [consoleHandler],
  });
  loggers.set("", defaultLogger);
}

let colorEnvFlagSet = false;
Deno.permissions.query({
  name: "env",
  variable: "CLICOLOR_FORCE",
})
  // do the check lazily to improve starts
  .then((perm) => {
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
