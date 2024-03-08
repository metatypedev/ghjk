import { std_path } from "../deps/common.ts";

const root = import.meta.dirname && std_path.dirname(import.meta.dirname);

export function relativeFileUrl(url: string) {
  if (root) {
    const moduleUrl = new URL(url);
    if (moduleUrl.protocol === "file:") {
      moduleUrl.pathname = std_path.relative(root, moduleUrl.pathname);
      return moduleUrl.href;
    }
  }
  return url;
}

export function absoluteFileUrl(url: string) {
  if (root) {
    const moduleUrl = new URL(url);
    if (moduleUrl.protocol === "file:") {
      moduleUrl.pathname = std_path.resolve(root, "./" + moduleUrl.pathname);
      return moduleUrl.href;
    }
  }
  return url;
}
