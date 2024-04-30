// Copyright 2018-2024 the Deno authors. All rights reserved. MIT license.
// This module is browser compatible.

import { readerFromStreamReader as _readerFromStreamReader } from "jsr:/@std/io@^0.221.0/reader-from-stream-reader";
import type { Reader } from "jsr:/@std/io@^0.221.0/types";

/**
 * Create a {@linkcode Reader} from a {@linkcode ReadableStreamDefaultReader}.
 *
 * @example
 * ```ts
 * import { copy } from "@std/io/copy";
 * import { readerFromStreamReader } from "@std/streams/reader-from-stream-reader";
 *
 * const res = await fetch("https://deno.land");
 * using file = await Deno.open("./deno.land.html", { create: true, write: true });
 *
 * const reader = readerFromStreamReader(res.body!.getReader());
 * await copy(reader, file);
 * ```
 *
 * @deprecated (will be removed in 1.0.0) Import from {@link https://deno.land/std/io/reader_from_stream_reader.ts} instead.
 */
export function readerFromStreamReader(
  streamReader: ReadableStreamDefaultReader<Uint8Array>,
): Reader {
  return _readerFromStreamReader(streamReader);
}
