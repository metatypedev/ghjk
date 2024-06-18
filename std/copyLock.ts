import { $, expandGlobsAndAbsolutize, Path } from "../utils/mod.ts";
import { std_fs } from "../deps/common.ts";

/**
 * Copies the files under the key to the locations in the values.
 *
 * Supports globs.
 */
export async function copyLock(
  wd: Path,
  map: Record<string, string[]>,
  opts?: Omit<std_fs.ExpandGlobOptions, "root">,
): Promise<boolean> {
  let dirty = false;
  await $.co(
    Object.entries(map)
      .map(async ([file, copies]) => {
        const url = wd.resolve(file);
        const text = await url.readText();

        await $.co(
          copies.map(async (pathOrGlob) => {
            const paths = await expandGlobsAndAbsolutize(
              pathOrGlob,
              wd.toString(),
              opts,
            );

            await $.co(paths.map(async (copy) => {
              const copyUrl = $.path(copy);
              const copyText = await copyUrl.readText();

              if (copyText != text) {
                copyUrl.writeText(text);
                $.logStep(`Updated ${wd.relative(copyUrl)}`);
                dirty = true;
              } else {
                $.logLight(`No change ${wd.relative(copyUrl)}`);
              }
            }));
          }),
        );
      }),
  );
  return dirty;
}
