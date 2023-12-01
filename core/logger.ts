import { log, std_fmt_colors, std_path, std_url } from "../deps/common.ts";

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
    msg += `, ${JSON.stringify(arg)}`;
  });

  return msg;
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
