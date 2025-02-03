import { JSZip, std_fs, std_path, std_tar } from "./deps.ts";
import type { Path } from "../../deno_utils/mod.ts";

/**
 * - Uses file extension to determine archive type.
 * - Does not support extracting symlinks
 * - Does not support tarballs using {@link https://www.gnu.org/software/tar/manual/html_node/Sparse-Recovery.html | GnuSparse}
 */
export async function unarchive(
  path: string | Path,
  destDir: string | Path = "./",
  extOpt?: string,
) {
  if (typeof path == "object") {
    path = path.toString();
  }
  if (typeof destDir == "object") {
    destDir = destDir.toString();
  }
  const ext = extOpt ?? std_path.extname(path);
  switch (ext) {
    case ".gz":
    case ".tar.gz":
    case ".tgz":
      await untgz(path, destDir);
      break;
    case ".tar":
      await untar(path, destDir);
      break;
    case ".zip":
      await unzip(path, destDir);
      break;
    default:
      throw Error("unsupported archive extension: ${ext}");
  }
}

export async function untgz(
  path: string,
  destDir = "./",
) {
  using tarFile = await Deno.open(path, {
    read: true,
  });

  try {
    await untarReader(
      tarFile.readable
        .pipeThrough(new DecompressionStream("gzip")),
      destDir,
    );
  } catch (err) {
    throw err;
  }
}

export async function untar(
  path: string,
  destDir = "./",
) {
  using tarFile = await Deno.open(path, {
    read: true,
  });

  try {
    await untarReader(tarFile.readable, destDir);
  } catch (err) {
    throw err;
  }
}

enum TarTypeflag {
  REGTYPE = "0", /* regular file */
  AREGTYPE = "\0", /* regular file */
  LNKTYPE = "1", /* link */
  SYMTYPE = "2", /* reserved */
  CHRTYPE = "3", /* character special */
  BLKTYPE = "4", /* block special */
  DIRTYPE = "5", /* directory */
  FIFOTYPE = "6", /* FIFO special */
  CONTTYPE = "7", /* reserved */
}

/**
 * This does not close the reader.
 */
export async function untarReader(
  reader: ReadableStream<Uint8Array>,
  destDir = "./",
) {
  for await (const entry of reader.pipeThrough(new std_tar.UntarStream())) {
    const filePath = std_path.resolve(destDir, entry.path);
    const parentPath = std_path.dirname(filePath);
    await Deno.mkdir(parentPath, { recursive: true });

    if (entry.header.typeflag == TarTypeflag.DIRTYPE) {
      // FIXME: we don't support directory modes
      await Deno.mkdir(filePath, { recursive: true });
    } else if (entry.header.typeflag == TarTypeflag.SYMTYPE) {
      await Deno.symlink(
        std_path.relative(
          parentPath,
          //filePath,
          std_path.resolve(parentPath, entry.header.linkname),
        ),
        filePath,
      );
    } else if (
      entry.header.typeflag == TarTypeflag.REGTYPE ||
      entry.header.typeflag == TarTypeflag.AREGTYPE
    ) {
      await Deno.mkdir(std_path.dirname(filePath), { recursive: true });
      using file = await Deno.open(filePath, {
        create: true,
        truncate: true,
        write: true,
        // FIXME: weird parsing due to https://github.com/denoland/std/pull/6376
        mode: parseInt(
          (parseInt(entry.header.mode.toString(), 8) * 0o10).toString(),
        ),
      });
      await entry.readable?.pipeTo(file.writable);
    } else {
      throw Error(
        "unsupported typeflag in tar entry: " + JSON.stringify(entry),
      );
    }
  }
}

export async function unzip(
  path: string,
  destDir = "./",
) {
  const zipArc = new JSZip();
  await zipArc.loadAsync(await Deno.readFile(path));
  await Promise.all(
    Object.entries(zipArc.files).map(async ([_, entry]) => {
      const filePath = std_path.resolve(destDir, entry.name);
      if (entry.dir) {
        await std_fs.ensureDir(filePath);
        return;
      }
      await std_fs.ensureDir(std_path.dirname(filePath));
      const buf = await entry.async("uint8array");
      await Deno.writeFile(filePath, buf, {
        create: true,
        // FIXME: windows support
        mode: Number(entry.unixPermissions ?? 0o666),
      });
    }),
  );
}
