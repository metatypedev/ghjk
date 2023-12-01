import {
  Foras,
  std_fs,
  std_io,
  std_path,
  std_streams,
  std_tar,
  zipjs,
} from "../deps/plug.ts";

/// Uses file extension to determine type
/// Does not support symlinks
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
  // FIXME: replace Foras with zip.js from below if possible
  // this unzips the whole thing into memory first
  // but I was not able to figure out the
  await Foras.initBundledOnce();
  const tgzFile = await Deno.open(path, { read: true });
  const gzDec = new Foras.GzDecoder();
  await std_streams.copy(tgzFile, {
    write(buf) {
      const mem = new Foras.Memory(buf);
      gzDec.write(mem);
      mem.freeNextTick();
      return Promise.resolve(buf.length);
    },
  });
  const buf = gzDec.finish().copyAndDispose();
  await Deno.writeFile("/tmp/my.tar", buf);
  await untarReader(new std_io.Buffer(buf), dest);
}
export async function untar(
  path: string,
  dest = "./",
) {
  const tarFile = await Deno.open(path, {
    read: true,
  });

  try {
    await untarReader(tarFile, dest);
  } catch (err) {
    throw err;
  } finally {
    tarFile.close();
  }
}

/// This does not close the reader
export async function untarReader(
  reader: Deno.Reader,
  dest = "./",
) {
  for await (const entry of new std_tar.Untar(reader)) {
    const filePath = std_path.resolve(dest, entry.fileName);
    if (entry.type === "directory") {
      await std_fs.ensureDir(filePath);
      continue;
    }
    await std_fs.ensureDir(std_path.dirname(filePath));
    const file = await Deno.open(filePath, {
      create: true,
      truncate: true,
      write: true,
      mode: entry.fileMode,
    });
    await std_streams.copy(entry, file);
    file.close();
  }
}

export async function unzip(
  path: string,
  dest = "./",
) {
  const zipFile = await Deno.open(path, { read: true });
  const zipReader = new zipjs.ZipReader(zipFile.readable);
  try {
    await Promise.allSettled(
      (await zipReader.getEntries()).map(async (entry) => {
        const filePath = std_path.resolve(dest, entry.filename);
        if (entry.directory) {
          await std_fs.ensureDir(filePath);
          return;
        }
        await std_fs.ensureDir(std_path.dirname(filePath));
        const file = await Deno.open(filePath, {
          create: true,
          truncate: true,
          write: true,
          mode: entry.externalFileAttribute >> 16,
        });
        if (!entry.getData) throw Error("impossible");
        await entry.getData(file.writable);
      }),
    );
  } catch (err) {
    throw err;
  } finally {
    zipReader.close();
  }
}
