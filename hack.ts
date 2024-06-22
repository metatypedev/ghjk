//! This file allows an easy way to start with the typescript ghjkfile
//! but is generally insecure for serious usage.
//!
//! If your ghjkfile imports a malicious module, the module could
//! import the functions defined herin and mess with your ghjkfile.

export * from "./mod.ts";
import { file } from "./mod.ts";
import logger from "./utils/logger.ts";

const ghjk = file();

export const sophon = Object.freeze(ghjk.sophon);
export const config = Object.freeze(firstCallerCheck(ghjk.config));
export const env = Object.freeze(firstCallerCheck(ghjk.env));
export const install = Object.freeze(firstCallerCheck(ghjk.install));
export const task = Object.freeze(firstCallerCheck(ghjk.task));

// capture exit fn to avoid malicous caller from
// changing it on Deno object
// WARN: the following capture only works if the
// hack.ts module is the first import
const exitFn = Deno.exit;
let firstCaller: string | undefined;

/**
 * The following wrapper kills the program if it detects callers to `fn`
 * from more than one file.
 *
 * This is a weak hack to prevent malicous imported scripts from modify the ghjk config
 * through the above functions.
 */
function firstCallerCheck<F extends (...args: any[]) => any>(fn: F): F {
  return ((...args) => {
    const caller = getCaller();
    if (!caller) {
      logger(import.meta).error(
        `unable to detect \`hack.ts\` caller, no stack traces availaible`,
      );
      // prefer exit of throw here since malicious user might catch it otherwise
      exitFn(1);
    } else if (firstCaller === undefined) {
      firstCaller = caller;
    } else if (caller !== firstCaller) {
      logger(import.meta).error(
        `new \`hack.ts\` caller detected: ${caller} != ${firstCaller}`,
      );
      exitFn(1);
    }
    return fn(...args);
  }) as F;
}

// lifted from https://github.com/apiel/caller/blob/ead98/caller.ts
// MIT License 2020 Alexander Piel
interface Bind {
  cb?: (file: string) => string;
}
function getCaller(this: Bind | any, levelUp = 3) {
  const err = new Error();
  const stack = err.stack?.split("\n")[levelUp];
  if (stack) {
    return getFile.bind(this)(stack);
  }
  function getFile(this: Bind | any, stack: string): string {
    stack = stack.substring(stack.indexOf("at ") + 3);
    if (!stack.startsWith("file://")) {
      stack = stack.substring(stack.lastIndexOf("(") + 1);
    }
    const path = stack.split(":");
    let file;
    if (Deno.build.os == "windows") {
      file = `${path[0]}:${path[1]}:${path[2]}`;
    } else {
      file = `${path[0]}:${path[1]}`;
    }

    if ((this as Bind)?.cb) {
      const cb = (this as Bind).cb as any;
      file = cb(file);
    }
    return file;
  }
}
