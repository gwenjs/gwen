import { statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

type ReadSourceFile = ts.CompilerHost["getSourceFile"];

interface CachedSource {
  mtimeMs: number;
  size: number;
  file: ts.SourceFile;
}

/**
 * Parsed source files shared between the programs of one call site.
 * The caller serves its synthetic files first and hands every other file to
 * `through`, so a synthetic file never enters the cache.
 *
 * A cached file is keyed by its resolved path, the language version (or, for
 * the options form, the language version, the implied node format and the
 * JSDoc parsing mode TypeScript passes), and it is served only while its
 * modification time and size are unchanged; otherwise it is parsed again.
 *
 * Sharing a bound `SourceFile` between programs is safe only because a cache
 * belongs to one call site. The compiler options of a site are fixed and its
 * paths resolve the same way in every program. The binder runs once per file,
 * with the options of the first program that uses it, and each program writes
 * `fileName`, `path`, `resolvedPath`, `originalFileName` and `packageJsonScope`
 * back onto the file. A cache is therefore never shared with a site that has
 * other options or resolves paths differently.
 */
export class SourceCache {
  private readonly files = new Map<string, CachedSource>();
  private count = 0;

  /** Number of real parses made through this cache. */
  get parses(): number {
    return this.count;
  }

  /** Wrap the read-from-disk fallback of a compiler host. */
  through(read: ReadSourceFile): ReadSourceFile {
    return (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
      const resolved = path.resolve(fileName);
      const stat = statSync(resolved, { throwIfNoEntry: false });
      if (stat === undefined) {
        return read(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
      }
      const key = `${resolved}\0${versionKey(languageVersionOrOptions)}`;
      const hit = this.files.get(key);
      if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.file;
      const file = read(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
      if (file === undefined) return undefined;
      this.count += 1;
      this.files.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, file });
      return file;
    };
  }

  /** Forget every cached file. Used by tests; no production code calls it. */
  clear(): void {
    this.files.clear();
  }
}

function versionKey(
  languageVersionOrOptions: ts.ScriptTarget | ts.CreateSourceFileOptions,
): string {
  if (typeof languageVersionOrOptions === "number") return `${languageVersionOrOptions}`;
  const { languageVersion, impliedNodeFormat, jsDocParsingMode } = languageVersionOrOptions;
  return `${languageVersion}:${impliedNodeFormat ?? ""}:${jsDocParsingMode ?? ""}`;
}
