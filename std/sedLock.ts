import { $, Path, unwrapZodRes } from "../utils/mod.ts";
import { std_fs, zod } from "../deps/common.ts";

export const lockfileValidator = zod.object({
  /**
   * A map of paths/globs => regexp strings => replacements.
   *
   * Rexeps are expected to have two match groups.
   * Replacement will be placed between the two groups.
   * TODO: use named match groups instead.
   */
  lines: zod.record(
    zod.string(),
    zod.tuple([
      zod.union([zod.string(), zod.instanceof(RegExp)]),
      zod.string(),
    ]).array(),
  ),
  ignores: zod.string().array().nullish(),
});

export type GrepLockfile = zod.input<typeof lockfileValidator>;

/**
 * Find and replace a set of strings across a directory.
 * Useful to keep certain strings consistent across changes.
 *
 * It will throw an error if not even one hit is found for each pattern.
 *
 * Avoid globstars over your entire working dir unless you're being careful
 * with your ignores.
 */
export async function sedLock(
  workingDir: Path,
  lockfileIn: GrepLockfile,
): Promise<boolean> {
  const { lines, ignores } = unwrapZodRes(
    lockfileValidator.safeParse(lockfileIn),
  );

  let dirty = false;

  const workSet = [] as [Path, string][];

  await $.co(
    Object
      .entries(lines)
      .map(async ([glob, lookups]) => {
        const paths = await Array.fromAsync(
          std_fs.expandGlob(glob, {
            root: workingDir.toString(),
            includeDirs: false,
            globstar: true,
            exclude: ignores ?? [],
          }),
        );

        if (paths.length == 0) {
          throw new Error(
            `No files found for ${glob}, please check and retry.`,
          );
        }

        const matches = Object.fromEntries(
          lookups.map(([key]) => [key.toString(), 0]),
        );

        await $.co(
          paths.map(async ({ path: pathStr }) => {
            const path = $.path(pathStr);
            const text = await path.readText();
            const rewrite = [...text.split("\n")];

            for (const [pattern, replacement] of lookups) {
              const regex = typeof pattern == "string"
                ? new RegExp(pattern)
                : pattern;

              for (let i = 0; i < rewrite.length; i += 1) {
                if (regex.test(rewrite[i])) {
                  matches[pattern.toString()] += 1;
                }

                rewrite[i] = rewrite[i].replace(
                  regex,
                  `$1${replacement}$2`,
                );
              }
            }

            const newText = rewrite.join("\n");
            if (text != newText) {
              workSet.push([path, newText]);
              dirty = true;
            } else {
              // $.logLight(`No change ${workingDir.relative(path)}`);
            }
          }),
        );

        for (const [pattern, count] of Object.entries(matches)) {
          if (count == 0) {
            throw new Error(
              `No matches found for ${pattern} in ${glob}, please check and retry.`,
            );
          }
        }
      }),
  );

  // we prefer all settled for the destructive operation
  await Promise.allSettled(
    workSet.map(async ([path, newText]) => {
      await path.writeText(newText);
      $.logStep(`Updated ${workingDir.relative(path)}`);
    }),
  );

  return dirty;
}
