import { $, Path } from "../../deno_utils/mod.ts";

export async function ignoresFromFile(path: string | Path, theDollar = $) {
  return ignoresFromContent(await theDollar.path(path).readText());
}

export function ignoresFromContent(content: string) {
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((line) => line.length > 0)
    .map((l) => `${l}${l.endsWith("*") ? "" : "*"}`);
}
