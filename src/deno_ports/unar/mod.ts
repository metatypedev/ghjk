import { JSZip, std_fs, std_path, std_tar } from "./deps.ts";

/**
 * - Uses file extension to determine archive type.
 * - Does not support extracting symlinks
 * - Does not support tarballs using {@link https://www.gnu.org/software/tar/manual/html_node/Sparse-Recovery.html | GnuSparse}
 */
export async function unarchive(
  path: string,
  dest = "./",
  ext = std_path.extname(path),
) {
  switch (ext) {
    case ".gz":
    case ".tar.gz":
    case ".tgz":
      await untgz(path, dest);
      break;
    case ".tar":
      await untar(path, dest);
      break;
    case ".zip":
      await unzip(path, dest);
      break;
    default:
      throw Error("unsupported archive extension: ${ext}");
  }
}

export async function untgz(
  path: string,
  dest = "./",
) {
  const tarFile = await Deno.open(path, {
    read: true,
  });

  try {
    await untarReader(
      tarFile.readable
        .pipeThrough(new DecompressionStream("gzip")),
      dest,
    );
  } catch (err) {
    throw err;
  } finally {
    tarFile.close();
  }
}

export async function untar(
  path: string,
  dest = "./",
) {
  const tarFile = await Deno.open(path, {
    read: true,
  });

  try {
    await untarReader(tarFile.readable, dest);
  } catch (err) {
    throw err;
  } finally {
    tarFile.close();
  }
}

/**
 * This does not close the reader.
 */
export async function untarReader(
  reader: ReadableStream<Uint8Array>,
  dest = "./",
) {
  for await (const entry of reader.pipeThrough(new std_tar.UntarStream())) {
    const filePath = std_path.resolve(dest, entry.path);
    await std_fs.ensureDir(std_path.dirname(filePath));
    const file = await Deno.open(filePath, {
      create: true,
      truncate: true,
      write: true,
      mode: entry.header.mode,
    });
    await entry.readable?.pipeTo(file.writable);
  }
}

export async function unzip(
  path: string,
  dest = "./",
) {
  const zipArc = new JSZip();
  await zipArc.loadAsync(await Deno.readFile(path));
  await Promise.all(
    Object.entries(zipArc.files).map(async ([_, entry]) => {
      const filePath = std_path.resolve(dest, entry.name);
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
