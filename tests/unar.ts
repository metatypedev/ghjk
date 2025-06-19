import { unarchive } from "../src/deno_ports/unar/mod.ts";
import { downloadFile } from "../src/deno_utils/mod.ts";
import { $, asyncRc } from "../src/deno_utils/mod.ts";
import { std_url } from "./deps.ts";

const cases = [
  {
    name: "zip",
    url:
      "https://github.com/protocolbuffers/protobuf/releases/download/v29.3/protoc-29.3-linux-x86_64.zip",
    expect: {
      "bin/protoc": {
        isFile: true,
      },
    },
  },
  {
    name: "gzip_tar",
    url:
      "https://github.com/rui314/mold/releases/download/v2.36.0/mold-2.36.0-x86_64-linux.tar.gz",
    expect: {
      "mold-2.36.0-x86_64-linux/bin/ld.mold": {
        isSymlink: true,
      },
      "mold-2.36.0-x86_64-linux/bin/mold": {
        isFile: true,
      },
    } satisfies Record<string, Partial<Deno.FileInfo>>,
  },
] satisfies Array<
  { name: string; expect: Record<string, Partial<Deno.FileInfo>>; url: string }
>;

for (const testCase of cases) {
  Deno.test(`unar/${testCase.name}`, async () => {
    const tempDir = asyncRc(
      $.path(await Deno.makeTempDir({ prefix: "ghjk_unar" })),
      (path) => path.remove({ recursive: true }),
      // $.path(`/tmp/ghjk_unar_${testCase.name}`),
      // async () => {},
    );
    const path = tempDir.val.join(std_url.basename(testCase.url)).toString();
    await downloadFile({
      url: testCase.url,
      tmpDirPath: tempDir.val.join("tmp").toString(),
      downloadPath: tempDir.val.toString(),
    });
    const destDir = tempDir.val.join("dest");
    await unarchive(path, destDir);
    await $.co(
      Object.entries(testCase.expect ?? {})
        .map(async ([expectedPath, info]) => {
          const path = destDir.join(expectedPath);
          const stat = await path.lstat();
          if (!stat) {
            throw new Error(`expected file not found in extraction: ${path}`);
          }
          for (const [key, val] of Object.entries(info)) {
            if (val != stat[key as keyof Deno.FileInfo]) {
              throw new Error(
                `stat prop mismatch at ${key} of ${path}: ${$.inspect(stat)}`,
              );
            }
          }
        }),
    );
  });
}
