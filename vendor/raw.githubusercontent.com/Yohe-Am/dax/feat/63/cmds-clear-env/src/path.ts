import { writeAll, writeAllSync } from "@std/io/write-all";
import * as stdPath from "@std/path";

import { copy, copySync } from "@std/fs/copy";
import { emptyDir, emptyDirSync } from "@std/fs/empty-dir";
import { ensureDir, ensureDirSync } from "@std/fs/ensure-dir";
import { ensureFile, ensureFileSync } from "@std/fs/ensure-file";
import { expandGlob, expandGlobSync } from "@std/fs/expand-glob";
import { walk, walkSync } from "@std/fs/walk";
import { symbols } from "./common.ts";

/**
 * `ExpandGlobOptions` from https://deno.land/std/fs/expand_glob.ts
 * @internal
 */
type DenoStdExpandGlobOptions = import("@std/fs/expand-glob").ExpandGlobOptions;
export type ExpandGlobOptions = DenoStdExpandGlobOptions;
/**
 * `WalkOptions` from https://deno.land/std/fs/walk.ts
 * @internal
 */
type DenoStdWalkOptions = import("@std/fs/walk").WalkOptions;
export type WalkOptions = DenoStdWalkOptions;

const PERIOD_CHAR_CODE = ".".charCodeAt(0);

/** @internal */
export function createPath(path: string | URL | ImportMeta | Path): Path {
  if (path instanceof Path) {
    return path;
  } else {
    return new Path(path);
  }
}

export interface WalkEntry extends Deno.DirEntry {
  path: Path;
}

export interface PathSymlinkOptions {
  /** Creates the symlink as absolute or relative. */
  kind: "absolute" | "relative";
}

export interface SymlinkOptions extends Partial<Deno.SymlinkOptions>, Partial<PathSymlinkOptions> {
}

/**
 * Holds a reference to a path providing helper methods.
 *
 * Create one via `$`: `const srcDir = $.path("src");`
 */
export class Path {
  readonly #path: string;
  #knownResolved = false;

  /** This is a special symbol that allows different versions of
   * Dax's `Path` API to match on `instanceof` checks. Ideally
   * people shouldn't be mixing versions, but if it happens then
   * this will maybe reduce some bugs (or cause some... tbd).
   * @internal
   */
  private static instanceofSymbol = Symbol.for("dax.Path");

  constructor(path: string | URL | ImportMeta | Path) {
    if (path instanceof URL) {
      this.#path = stdPath.fromFileUrl(path);
    } else if (path instanceof Path) {
      this.#path = path.toString();
    } else if (typeof path === "string") {
      if (path.startsWith("file://")) {
        this.#path = stdPath.fromFileUrl(path);
      } else {
        this.#path = path;
      }
    } else {
      this.#path = stdPath.fromFileUrl(path.url);
    }
  }

  /** @internal */
  static [Symbol.hasInstance](instance: any): boolean {
    // this should never change because it should work accross versions
    return instance?.constructor?.instanceofSymbol === Path.instanceofSymbol;
  }

  /** @internal */
  [Symbol.for("Deno.customInspect")](): string {
    return `Path("${this.#path}")`;
  }

  /** @internal */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `Path("${this.#path}")`;
  }

  /** Gets the string representation of this path. */
  toString(): string {
    return this.#path;
  }

  /** Resolves the path and gets the file URL. */
  toFileUrl(): URL {
    const resolvedPath = this.resolve();
    return stdPath.toFileUrl(resolvedPath.toString());
  }

  /** If this path reference is the same as another one. */
  equals(otherPath: Path): boolean {
    return this.resolve().toString() === otherPath.resolve().toString();
  }

  /** Joins the provided path segments onto this path. */
  join(...pathSegments: string[]): Path {
    return new Path(stdPath.join(this.#path, ...pathSegments));
  }

  /** Resolves this path to an absolute path along with the provided path segments. */
  resolve(...pathSegments: string[]): Path {
    if (this.#knownResolved && pathSegments.length === 0) {
      return this;
    }

    const resolvedPath = stdPath.resolve(this.#path, ...pathSegments);
    if (pathSegments.length === 0 && resolvedPath === this.#path) {
      this.#knownResolved = true;
      return this;
    } else {
      const pathRef = new Path(resolvedPath);
      pathRef.#knownResolved = true;
      return pathRef;
    }
  }

  /**
   * Normalizes the `path`, resolving `'..'` and `'.'` segments.
   * Note that resolving these segments does not necessarily mean that all will be eliminated.
   * A `'..'` at the top-level will be preserved, and an empty path is canonically `'.'`.
   */
  normalize(): Path {
    return new Path(stdPath.normalize(this.#path));
  }

  /** Follows symlinks and gets if this path is a directory. */
  isDirSync(): boolean {
    return this.statSync()?.isDirectory ?? false;
  }

  /** Follows symlinks and gets if this path is a file. */
  isFileSync(): boolean {
    return this.statSync()?.isFile ?? false;
  }

  /** Gets if this path is a symlink. */
  isSymlinkSync(): boolean {
    return this.lstatSync()?.isSymlink ?? false;
  }

  /** Gets if this path is an absolute path. */
  isAbsolute(): boolean {
    return stdPath.isAbsolute(this.#path);
  }

  /** Gets if this path is relative. */
  isRelative(): boolean {
    return !this.isAbsolute();
  }

  /** Resolves the `Deno.FileInfo` of this path following symlinks. */
  async stat(): Promise<Deno.FileInfo | undefined> {
    try {
      return await Deno.stat(this.#path);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        return undefined;
      } else {
        throw err;
      }
    }
  }

  /** Synchronously resolves the `Deno.FileInfo` of this
   * path following symlinks. */
  statSync(): Deno.FileInfo | undefined {
    try {
      return Deno.statSync(this.#path);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        return undefined;
      } else {
        throw err;
      }
    }
  }

  /** Resolves the `Deno.FileInfo` of this path without
   * following symlinks. */
  async lstat(): Promise<Deno.FileInfo | undefined> {
    try {
      return await Deno.lstat(this.#path);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        return undefined;
      } else {
        throw err;
      }
    }
  }

  /** Synchronously resolves the `Deno.FileInfo` of this path
   * without following symlinks. */
  lstatSync(): Deno.FileInfo | undefined {
    try {
      return Deno.lstatSync(this.#path);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        return undefined;
      } else {
        throw err;
      }
    }
  }

  /**
   * Gets the directory path. In most cases, it is recommended
   * to use `.parent()` instead since it will give you a `Path`.
   */
  dirname(): string {
    return stdPath.dirname(this.#path);
  }

  /** Gets the file or directory name of the path. */
  basename(): string {
    return stdPath.basename(this.#path);
  }

  /** Resolves the path getting all its ancestor directories in order. */
  *ancestors(): Generator<Path> {
    let ancestor = this.parent();
    while (ancestor != null) {
      yield ancestor;
      ancestor = ancestor.parent();
    }
  }

  *components(): Generator<string> {
    const path = this.normalize();
    let last_index = 0;

    // yield the prefix
    if (path.#path.startsWith("\\\\?\\")) {
      last_index = nextSlash(path.#path, 4);
      if (last_index === -1) {
        yield path.#path;
        return;
      } else {
        yield path.#path.substring(0, last_index);
        last_index += 1; // move past next slash
      }
    } else if (path.#path.startsWith("/")) {
      // move past the initial slash
      last_index += 1;
    }

    while (true) {
      const index = nextSlash(path.#path, last_index);
      if (index < 0) {
        const part = path.#path.substring(last_index);
        if (part.length > 0) {
          yield part;
        }
        return;
      }
      yield path.#path.substring(last_index, index);
      last_index = index + 1;
    }

    function nextSlash(path: string, start: number) {
      for (let i = start; i < path.length; i++) {
        const c = path.charCodeAt(i);
        if (c === 47 || c === 92) {
          return i;
        }
      }
      return -1;
    }
  }

  // This is private because this doesn't handle stuff like `\\?\` at the start
  // so it's only used internally with #endsWith for perf. API consumers should
  // use .components()
  *#rcomponents(): Generator<string> {
    const path = this.normalize();
    let last_index = undefined;
    while (last_index == null || last_index > 0) {
      const index = nextSlash(path.#path, last_index == null ? undefined : last_index - 1);
      if (index < 0) {
        const part = path.#path.substring(0, last_index);
        if (part.length > 0) {
          yield part;
        }
        return;
      }
      const part = path.#path.substring(index + 1, last_index);
      if (last_index != null || part.length > 0) {
        yield part;
      }
      last_index = index;
    }

    function nextSlash(path: string, start: number | undefined) {
      for (let i = start ?? path.length - 1; i >= 0; i--) {
        const c = path.charCodeAt(i);
        if (c === 47 || c === 92) {
          return i;
        }
      }
      return -1;
    }
  }

  startsWith(path: Path | URL | string): boolean {
    const startsWithComponents = ensurePath(path).components();
    for (const component of this.components()) {
      const next = startsWithComponents.next();
      if (next.done) {
        return true;
      }
      if (next.value !== component) {
        return false;
      }
    }
    return startsWithComponents.next().done ?? true;
  }

  endsWith(path: Path | URL | string): boolean {
    const endsWithComponents = ensurePath(path).#rcomponents();
    for (const component of this.#rcomponents()) {
      const next = endsWithComponents.next();
      if (next.done) {
        return true;
      }
      if (next.value !== component) {
        return false;
      }
    }
    return endsWithComponents.next().done ?? true;
  }

  /** Gets the parent directory or returns undefined if the parent is the root directory. */
  parent(): Path | undefined {
    const resolvedPath = this.resolve();
    const dirname = resolvedPath.dirname();
    if (dirname === resolvedPath.#path) {
      return undefined;
    } else {
      return new Path(dirname);
    }
  }

  /** Gets the parent or throws if the current directory was the root. */
  parentOrThrow(): Path {
    const parent = this.parent();
    if (parent == null) {
      throw new Error(`Cannot get the parent directory of '${this.#path}'.`);
    }
    return parent;
  }

  /**
   * Returns the extension of the path with leading period or undefined
   * if there is no extension.
   */
  extname(): string | undefined {
    const extName = stdPath.extname(this.#path);
    return extName.length === 0 ? undefined : extName;
  }

  /** Gets a new path reference with the provided extension. */
  withExtname(ext: string): Path {
    const currentExt = this.extname();
    const hasLeadingPeriod = ext.charCodeAt(0) === PERIOD_CHAR_CODE;
    if (!hasLeadingPeriod && ext.length !== 0) {
      ext = "." + ext;
    }
    return new Path(this.#path.substring(0, this.#path.length - (currentExt?.length ?? 0)) + ext);
  }

  /** Gets a new path reference with the provided file or directory name. */
  withBasename(basename: string): Path {
    const currentBaseName = this.basename();
    return new Path(this.#path.substring(0, this.#path.length - currentBaseName.length) + basename);
  }

  /** Gets the relative path from this path to the specified path. */
  relative(to: string | URL | Path): string {
    const toPath = ensurePath(to);
    return stdPath.relative(this.resolve().#path, toPath.resolve().#path);
  }

  /** Gets if the path exists. Beware of TOCTOU issues. */
  exists(): Promise<boolean> {
    return this.lstat().then((info) => info != null);
  }

  /** Synchronously gets if the path exists. Beware of TOCTOU issues. */
  existsSync(): boolean {
    return this.lstatSync() != null;
  }

  /** Resolves to the absolute normalized path, with symbolic links resolved. */
  realPath(): Promise<Path> {
    return Deno.realPath(this.#path).then((path) => new Path(path));
  }

  /** Synchronously resolves to the absolute normalized path, with symbolic links resolved. */
  realPathSync(): Path {
    return new Path(Deno.realPathSync(this.#path));
  }

  /** Expands the glob using the current path as the root. */
  async *expandGlob(
    glob: string | URL,
    options?: Omit<ExpandGlobOptions, "root">,
  ): AsyncGenerator<WalkEntry, void, unknown> {
    const entries = expandGlob(glob, {
      root: this.resolve().toString(),
      ...options,
    });
    for await (const entry of entries) {
      yield this.#stdWalkEntryToDax(entry);
    }
  }

  /** Synchronously expands the glob using the current path as the root. */
  *expandGlobSync(
    glob: string | URL,
    options?: Omit<ExpandGlobOptions, "root">,
  ): Generator<WalkEntry, void, unknown> {
    const entries = expandGlobSync(glob, {
      root: this.resolve().toString(),
      ...options,
    });
    for (const entry of entries) {
      yield this.#stdWalkEntryToDax(entry);
    }
  }

  /** Walks the file tree rooted at the current path, yielding each file or
   * directory in the tree filtered according to the given options. */
  async *walk(options?: WalkOptions): AsyncIterableIterator<WalkEntry> {
    // Resolve the path before walking so that these paths always point to
    // absolute paths in the case that someone changes the cwd after walking.
    for await (const entry of walk(this.resolve().toString(), options)) {
      yield this.#stdWalkEntryToDax(entry);
    }
  }

  /** Synchronously walks the file tree rooted at the current path, yielding each
   * file or directory in the tree filtered according to the given options. */
  *walkSync(options?: WalkOptions): Iterable<WalkEntry> {
    for (const entry of walkSync(this.resolve().toString(), options)) {
      yield this.#stdWalkEntryToDax(entry);
    }
  }

  #stdWalkEntryToDax(entry: import("@std/fs/walk").WalkEntry): WalkEntry {
    return {
      ...entry,
      path: new Path(entry.path),
    };
  }

  /** Creates a directory at this path.
   * @remarks By default, this is recursive.
   */
  async mkdir(options?: Deno.MkdirOptions): Promise<this> {
    await Deno.mkdir(this.#path, {
      recursive: true,
      ...options,
    });
    return this;
  }

  /** Synchronously creates a directory at this path.
   * @remarks By default, this is recursive.
   */
  mkdirSync(options?: Deno.MkdirOptions): this {
    Deno.mkdirSync(this.#path, {
      recursive: true,
      ...options,
    });
    return this;
  }

  /**
   * Creates a symlink to the provided target path.
   */
  async createSymlinkTo(
    targetPath: URL | Path,
    opts: Partial<Deno.SymlinkOptions> & PathSymlinkOptions,
  ): Promise<void>;
  /**
   * Creates a symlink at the provided path with the provided target text.
   */
  async createSymlinkTo(
    target: string,
    opts?: SymlinkOptions,
  ): Promise<void>;
  async createSymlinkTo(
    target: string | URL | Path,
    opts?: SymlinkOptions,
  ): Promise<void> {
    await createSymlink(this.#resolveCreateSymlinkOpts(target, opts));
  }

  /**
   * Synchronously creates a symlink to the provided target path.
   */
  createSymlinkToSync(
    targetPath: URL | Path,
    opts: Partial<Deno.SymlinkOptions> & PathSymlinkOptions,
  ): void;
  /**
   * Synchronously creates a symlink at the provided path with the provided target text.
   */
  createSymlinkToSync(
    target: string,
    opts?: SymlinkOptions,
  ): void;
  createSymlinkToSync(target: string | URL | Path, opts?: SymlinkOptions): void {
    createSymlinkSync(this.#resolveCreateSymlinkOpts(target, opts));
  }

  #resolveCreateSymlinkOpts(target: string | URL | Path, opts: SymlinkOptions | undefined): CreateSymlinkOpts {
    if (opts?.kind == null) {
      if (typeof target === "string") {
        return {
          fromPath: this.resolve(),
          targetPath: ensurePath(target),
          text: target,
          type: opts?.type,
        };
      } else {
        throw new Error("Please specify if this symlink is absolute or relative. Otherwise provide the target text.");
      }
    }
    const targetPath = ensurePath(target).resolve();
    if (opts?.kind === "relative") {
      const fromPath = this.resolve();
      let relativePath: string;
      if (fromPath.dirname() === targetPath.dirname()) {
        // we don't want it to do `../basename`
        relativePath = targetPath.basename();
      } else {
        relativePath = fromPath.relative(targetPath);
      }
      return {
        fromPath,
        targetPath,
        text: relativePath,
        type: opts?.type,
      };
    } else {
      return {
        fromPath: this.resolve(),
        targetPath,
        text: targetPath.#path,
        type: opts?.type,
      };
    }
  }

  /** Reads the entries in the directory. */
  async *readDir(): AsyncIterable<WalkEntry> {
    const dir = this.resolve();
    for await (const entry of Deno.readDir(dir.#path)) {
      yield {
        ...entry,
        path: dir.join(entry.name),
      };
    }
  }

  /** Synchronously reads the entries in the directory. */
  *readDirSync(): Iterable<WalkEntry> {
    const dir = this.resolve();
    for (const entry of Deno.readDirSync(dir.#path)) {
      yield {
        ...entry,
        path: dir.join(entry.name),
      };
    }
  }

  /** Reads only the directory file paths, not including symlinks. */
  async *readDirFilePaths(): AsyncIterable<Path> {
    const dir = this.resolve();
    for await (const entry of Deno.readDir(dir.#path)) {
      if (entry.isFile) {
        yield dir.join(entry.name);
      }
    }
  }

  /** Synchronously reads only the directory file paths, not including symlinks. */
  *readDirFilePathsSync(): Iterable<Path> {
    const dir = this.resolve();
    for (const entry of Deno.readDirSync(dir.#path)) {
      if (entry.isFile) {
        yield dir.join(entry.name);
      }
    }
  }

  /** Reads the bytes from the file. */
  readBytes(options?: Deno.ReadFileOptions): Promise<Uint8Array> {
    return Deno.readFile(this.#path, options);
  }

  /** Synchronously reads the bytes from the file. */
  readBytesSync(): Uint8Array {
    return Deno.readFileSync(this.#path);
  }

  /** Calls `.readBytes()`, but returns undefined if the path doesn't exist. */
  readMaybeBytes(options?: Deno.ReadFileOptions): Promise<Uint8Array | undefined> {
    return notFoundToUndefined(() => this.readBytes(options));
  }

  /** Calls `.readBytesSync()`, but returns undefined if the path doesn't exist. */
  readMaybeBytesSync(): Uint8Array | undefined {
    return notFoundToUndefinedSync(() => this.readBytesSync());
  }

  /** Reads the text from the file. */
  readText(options?: Deno.ReadFileOptions): Promise<string> {
    return Deno.readTextFile(this.#path, options);
  }

  /** Synchronously reads the text from the file. */
  readTextSync(): string {
    return Deno.readTextFileSync(this.#path);
  }

  /** Calls `.readText()`, but returns undefined when the path doesn't exist.
   * @remarks This still errors for other kinds of errors reading a file.
   */
  readMaybeText(options?: Deno.ReadFileOptions): Promise<string | undefined> {
    return notFoundToUndefined(() => this.readText(options));
  }

  /** Calls `.readTextSync()`, but returns undefined when the path doesn't exist.
   * @remarks This still errors for other kinds of errors reading a file.
   */
  readMaybeTextSync(): string | undefined {
    return notFoundToUndefinedSync(() => this.readTextSync());
  }

  /** Reads and parses the file as JSON, throwing if it doesn't exist or is not valid JSON. */
  async readJson<T>(options?: Deno.ReadFileOptions): Promise<T> {
    return this.#parseJson<T>(await this.readText(options));
  }

  /** Synchronously reads and parses the file as JSON, throwing if it doesn't
   * exist or is not valid JSON. */
  readJsonSync<T>(): T {
    return this.#parseJson<T>(this.readTextSync());
  }

  #parseJson<T>(text: string) {
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new Error(`Failed parsing JSON in '${this.toString()}'.`, {
        cause: err,
      });
    }
  }

  /**
   * Calls `.readJson()`, but returns undefined if the file doesn't exist.
   * @remarks This method will still throw if the file cannot be parsed as JSON.
   */
  readMaybeJson<T>(options?: Deno.ReadFileOptions): Promise<T | undefined> {
    return notFoundToUndefined(() => this.readJson<T>(options));
  }

  /**
   * Calls `.readJsonSync()`, but returns undefined if the file doesn't exist.
   * @remarks This method will still throw if the file cannot be parsed as JSON.
   */
  readMaybeJsonSync<T>(): T | undefined {
    return notFoundToUndefinedSync(() => this.readJsonSync<T>());
  }

  /** Writes out the provided bytes to the file. */
  async write(data: Uint8Array, options?: Deno.WriteFileOptions): Promise<this> {
    await this.#withFileForWriting(options, (file) => file.write(data));
    return this;
  }

  /** Synchronously writes out the provided bytes to the file. */
  writeSync(data: Uint8Array, options?: Deno.WriteFileOptions): this {
    this.#withFileForWritingSync(options, (file) => {
      file.writeSync(data);
    });
    return this;
  }

  /** Writes out the provided text to the file. */
  async writeText(text: string, options?: Deno.WriteFileOptions): Promise<this> {
    await this.#withFileForWriting(options, (file) => file.writeText(text));
    return this;
  }

  /** Synchronously writes out the provided text to the file. */
  writeTextSync(text: string, options?: Deno.WriteFileOptions): this {
    this.#withFileForWritingSync(options, (file) => {
      file.writeTextSync(text);
    });
    return this;
  }

  /** Writes out the provided object as compact JSON. */
  async writeJson(obj: unknown, options?: Deno.WriteFileOptions): Promise<this> {
    const text = JSON.stringify(obj);
    await this.#writeTextWithEndNewLine(text, options);
    return this;
  }

  /** Synchronously writes out the provided object as compact JSON. */
  writeJsonSync(obj: unknown, options?: Deno.WriteFileOptions): this {
    const text = JSON.stringify(obj);
    this.#writeTextWithEndNewLineSync(text, options);
    return this;
  }

  /** Writes out the provided object as formatted JSON. */
  async writeJsonPretty(obj: unknown, options?: Deno.WriteFileOptions): Promise<this> {
    const text = JSON.stringify(obj, undefined, 2);
    await this.#writeTextWithEndNewLine(text, options);
    return this;
  }

  /** Synchronously writes out the provided object as formatted JSON. */
  writeJsonPrettySync(obj: unknown, options?: Deno.WriteFileOptions): this {
    const text = JSON.stringify(obj, undefined, 2);
    this.#writeTextWithEndNewLineSync(text, options);
    return this;
  }

  #writeTextWithEndNewLine(text: string, options: Deno.WriteFileOptions | undefined) {
    return this.#withFileForWriting(options, async (file) => {
      await file.writeText(text);
      await file.writeText("\n");
    });
  }

  /** Appends the provided bytes to the file. */
  async append(data: Uint8Array, options?: Omit<Deno.WriteFileOptions, "append">): Promise<this> {
    await this.#withFileForAppending(options, (file) => file.write(data));
    return this;
  }

  /** Synchronously appends the provided bytes to the file. */
  appendSync(data: Uint8Array, options?: Omit<Deno.WriteFileOptions, "append">): this {
    this.#withFileForAppendingSync(options, (file) => {
      file.writeSync(data);
    });
    return this;
  }

  /** Appends the provided text to the file. */
  async appendText(text: string, options?: Omit<Deno.WriteFileOptions, "append">): Promise<this> {
    await this.#withFileForAppending(options, (file) => file.writeText(text));
    return this;
  }

  /** Synchronously appends the provided text to the file. */
  appendTextSync(text: string, options?: Omit<Deno.WriteFileOptions, "append">): this {
    this.#withFileForAppendingSync(options, (file) => {
      file.writeTextSync(text);
    });
    return this;
  }

  #withFileForAppending<T>(
    options: Omit<Deno.WriteFileOptions, "append"> | undefined,
    action: (file: FsFileWrapper) => Promise<T>,
  ) {
    return this.#withFileForWriting({
      append: true,
      ...options,
    }, action);
  }

  async #withFileForWriting<T>(
    options: Deno.WriteFileOptions | undefined,
    action: (file: FsFileWrapper) => Promise<T>,
  ) {
    const file = await this.#openFileMaybeCreatingDirectory({
      write: true,
      create: true,
      truncate: options?.append !== true,
      ...options,
    });
    try {
      return await action(file);
    } finally {
      try {
        file.close();
      } catch {
        // ignore
      }
    }
  }

  /** Opens a file, but handles if the directory does not exist. */
  async #openFileMaybeCreatingDirectory(options: Deno.OpenOptions) {
    const resolvedPath = this.resolve(); // pre-resolve before going async in case the cwd changes
    try {
      return await resolvedPath.open(options);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        // attempt to create the parent directory when it doesn't exist
        const parent = resolvedPath.parent();
        if (parent != null) {
          try {
            await parent.mkdir();
          } catch {
            throw err; // throw the original error
          }
        }
        return await resolvedPath.open(options);
      } else {
        throw err;
      }
    }
  }

  #writeTextWithEndNewLineSync(text: string, options: Deno.WriteFileOptions | undefined) {
    this.#withFileForWritingSync(options, (file) => {
      file.writeTextSync(text);
      file.writeTextSync("\n");
    });
  }

  #withFileForAppendingSync<T>(
    options: Omit<Deno.WriteFileOptions, "append"> | undefined,
    action: (file: FsFileWrapper) => T,
  ) {
    return this.#withFileForWritingSync({
      append: true,
      ...options,
    }, action);
  }

  #withFileForWritingSync<T>(options: Deno.WriteFileOptions | undefined, action: (file: FsFileWrapper) => T) {
    const file = this.#openFileForWritingSync(options);
    try {
      return action(file);
    } finally {
      try {
        file.close();
      } catch {
        // ignore
      }
    }
  }

  /** Opens a file for writing, but handles if the directory does not exist. */
  #openFileForWritingSync(options: Deno.WriteFileOptions | undefined) {
    return this.#openFileMaybeCreatingDirectorySync({
      write: true,
      create: true,
      truncate: options?.append !== true,
      ...options,
    });
  }

  /** Opens a file for writing, but handles if the directory does not exist. */
  #openFileMaybeCreatingDirectorySync(options: Deno.OpenOptions) {
    try {
      return this.openSync(options);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        // attempt to create the parent directory when it doesn't exist
        const parent = this.resolve().parent();
        if (parent != null) {
          try {
            parent.mkdirSync();
          } catch {
            throw err; // throw the original error
          }
        }
        return this.openSync(options);
      } else {
        throw err;
      }
    }
  }

  /** Changes the permissions of the file or directory. */
  async chmod(mode: number): Promise<this> {
    await Deno.chmod(this.#path, mode);
    return this;
  }

  /** Synchronously changes the permissions of the file or directory. */
  chmodSync(mode: number): this {
    Deno.chmodSync(this.#path, mode);
    return this;
  }

  /** Changes the ownership permissions of the file. */
  async chown(uid: number | null, gid: number | null): Promise<this> {
    await Deno.chown(this.#path, uid, gid);
    return this;
  }

  /** Synchronously changes the ownership permissions of the file. */
  chownSync(uid: number | null, gid: number | null): this {
    Deno.chownSync(this.#path, uid, gid);
    return this;
  }

  /** Creates a new file or opens the existing one. */
  create(): Promise<FsFileWrapper> {
    return Deno.create(this.#path)
      .then((file) => createFsFileWrapper(file));
  }

  /** Synchronously creates a new file or opens the existing one. */
  createSync(): FsFileWrapper {
    return createFsFileWrapper(Deno.createSync(this.#path));
  }

  /** Creates a file throwing if a file previously existed. */
  createNew(): Promise<FsFileWrapper> {
    return this.open({
      createNew: true,
      read: true,
      write: true,
    });
  }

  /** Synchronously creates a file throwing if a file previously existed. */
  createNewSync(): FsFileWrapper {
    return this.openSync({
      createNew: true,
      read: true,
      write: true,
    });
  }

  /** Opens a file. */
  open(options?: Deno.OpenOptions): Promise<FsFileWrapper> {
    return Deno.open(this.#path, options)
      .then((file) => createFsFileWrapper(file));
  }

  /** Opens a file synchronously. */
  openSync(options?: Deno.OpenOptions): FsFileWrapper {
    return createFsFileWrapper(Deno.openSync(this.#path, options));
  }

  /** Removes the file or directory from the file system. */
  async remove(options?: Deno.RemoveOptions): Promise<this> {
    await Deno.remove(this.#path, options);
    return this;
  }

  /** Removes the file or directory from the file system synchronously. */
  removeSync(options?: Deno.RemoveOptions): this {
    Deno.removeSync(this.#path, options);
    return this;
  }

  /**
   * Ensures that a directory is empty.
   * Deletes directory contents if the directory is not empty.
   * If the directory does not exist, it is created.
   * The directory itself is not deleted.
   */
  async emptyDir(): Promise<this> {
    await emptyDir(this.toString());
    return this;
  }

  /** Synchronous version of `emptyDir()` */
  emptyDirSync(): this {
    emptyDirSync(this.toString());
    return this;
  }

  /** Ensures that the directory exists.
   * If the directory structure does not exist, it is created. Like mkdir -p.
   */
  async ensureDir(): Promise<this> {
    await ensureDir(this.toString());
    return this;
  }

  /** Synchronously ensures that the directory exists.
   * If the directory structure does not exist, it is created. Like mkdir -p.
   */
  ensureDirSync(): this {
    ensureDirSync(this.toString());
    return this;
  }

  /**
   * Ensures that the file exists.
   * If the file that is requested to be created is in directories that do
   * not exist these directories are created. If the file already exists,
   * it is NOTMODIFIED.
   */
  async ensureFile(): Promise<this> {
    await ensureFile(this.toString());
    return this;
  }

  /**
   * Synchronously ensures that the file exists.
   * If the file that is requested to be created is in directories that do
   * not exist these directories are created. If the file already exists,
   * it is NOTMODIFIED.
   */
  ensureFileSync(): this {
    ensureFileSync(this.toString());
    return this;
  }

  /** Copies a file or directory to the provided destination.
   * @returns The destination file path.
   */
  async copy(destinationPath: string | URL | Path, options?: { overwrite?: boolean }): Promise<Path> {
    const pathRef = ensurePath(destinationPath);
    await copy(this.#path, pathRef.#path, options);
    return pathRef;
  }

  /** Copies a file or directory to the provided destination synchronously.
   * @returns The destination file path.
   */
  copySync(destinationPath: string | URL | Path, options?: { overwrite?: boolean }): Path {
    const pathRef = ensurePath(destinationPath);
    copySync(this.#path, pathRef.#path, options);
    return pathRef;
  }

  /**
   * Copies the file or directory to the specified directory.
   * @returns The destination file path.
   */
  copyToDir(destinationDirPath: string | URL | Path, options?: { overwrite?: boolean }): Promise<Path> {
    const destinationPath = ensurePath(destinationDirPath)
      .join(this.basename());
    return this.copy(destinationPath, options);
  }

  /**
   * Copies the file or directory to the specified directory synchronously.
   * @returns The destination file path.
   */
  copyToDirSync(destinationDirPath: string | URL | Path, options?: { overwrite?: boolean }): Path {
    const destinationPath = ensurePath(destinationDirPath)
      .join(this.basename());
    return this.copySync(destinationPath, options);
  }

  /**
   * Moves the file or directory returning a promise that resolves to
   * the renamed path.
   */
  rename(newPath: string | URL | Path): Promise<Path> {
    const pathRef = ensurePath(newPath);
    return Deno.rename(this.#path, pathRef.#path).then(() => pathRef);
  }

  /**
   * Moves the file or directory returning the renamed path synchronously.
   */
  renameSync(newPath: string | URL | Path): Path {
    const pathRef = ensurePath(newPath);
    Deno.renameSync(this.#path, pathRef.#path);
    return pathRef;
  }

  /**
   * Moves the file or directory to the specified directory.
   * @returns The destination file path.
   */
  renameToDir(destinationDirPath: string | URL | Path): Promise<Path> {
    const destinationPath = ensurePath(destinationDirPath)
      .join(this.basename());
    return this.rename(destinationPath);
  }

  /**
   * Moves the file or directory to the specified directory synchronously.
   * @returns The destination file path.
   */
  renameToDirSync(destinationDirPath: string | URL | Path): Path {
    const destinationPath = ensurePath(destinationDirPath)
      .join(this.basename());
    return this.renameSync(destinationPath);
  }

  /** Opens the file and pipes it to the writable stream. */
  async pipeTo(dest: WritableStream<Uint8Array>, options?: PipeOptions): Promise<this> {
    const file = await Deno.open(this.#path, { read: true });
    try {
      await file.readable.pipeTo(dest, options);
    } finally {
      try {
        file.close();
      } catch {
        // ignore
      }
    }
    return this;
  }
}

function ensurePath(path: string | URL | Path) {
  return path instanceof Path ? path : new Path(path);
}

async function createSymlink(opts: CreateSymlinkOpts) {
  let kind = opts.type;
  if (kind == null && Deno.build.os === "windows") {
    const info = await opts.targetPath.lstat();
    if (info?.isDirectory) {
      kind = "dir";
    } else if (info?.isFile) {
      kind = "file";
    } else {
      throw new Deno.errors.NotFound(
        `The target path '${opts.targetPath}' did not exist or path kind could not be determined. ` +
          `When the path doesn't exist, you need to specify a symlink type on Windows.`,
      );
    }
  }

  await Deno.symlink(
    opts.text,
    opts.fromPath.toString(),
    kind == null ? undefined : {
      type: kind,
    },
  );
}

interface CreateSymlinkOpts {
  fromPath: Path;
  targetPath: Path;
  text: string;
  type: "file" | "dir" | undefined;
}

function createSymlinkSync(opts: CreateSymlinkOpts) {
  let kind = opts.type;
  if (kind == null && Deno.build.os === "windows") {
    const info = opts.targetPath.lstatSync();
    if (info?.isDirectory) {
      kind = "dir";
    } else if (info?.isFile) {
      kind = "file";
    } else {
      throw new Deno.errors.NotFound(
        `The target path '${opts.targetPath}' did not exist or path kind could not be determined. ` +
          `When the path doesn't exist, you need to specify a symlink type on Windows.`,
      );
    }
  }

  Deno.symlinkSync(
    opts.text,
    opts.fromPath.toString(),
    kind == null ? undefined : {
      type: kind,
    },
  );
}

function createFsFileWrapper(file: Deno.FsFile): FsFileWrapper {
  Object.setPrototypeOf(file, FsFileWrapper.prototype);
  return file as FsFileWrapper;
}

export class FsFileWrapper extends Deno.FsFile {
  [symbols.readable](): ReadableStream<Uint8Array> {
    return this.readable;
  }

  [symbols.writable](): WritableStream<Uint8Array> {
    return this.writable;
  }

  /** Writes the provided text to this file. */
  writeText(text: string): Promise<this> {
    return this.writeBytes(new TextEncoder().encode(text));
  }

  /** Synchronously writes the provided text to this file. */
  writeTextSync(text: string): this {
    return this.writeBytesSync(new TextEncoder().encode(text));
  }

  /** Writes the provided bytes to the file. */
  async writeBytes(bytes: Uint8Array): Promise<this> {
    await writeAll(this, bytes);
    return this;
  }

  /** Synchronously writes the provided bytes to the file. */
  writeBytesSync(bytes: Uint8Array): this {
    writeAllSync(this, bytes);
    return this;
  }
}

async function notFoundToUndefined<T>(action: () => Promise<T>) {
  try {
    return await action();
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return undefined;
    } else {
      throw err;
    }
  }
}

function notFoundToUndefinedSync<T>(action: () => T) {
  try {
    return action();
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return undefined;
    } else {
      throw err;
    }
  }
}
