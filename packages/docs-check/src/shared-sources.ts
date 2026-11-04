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
 * `through`, so a synthetic file never enters the cache. A file is parsed again
 * when its size or modification time changes, or when TypeScript asks for
 * another language version. The compiler options of a site are fixed, so a
 * cache belongs to one site and is never shared with a site that has other
 * options.
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

  /** Forget every cached file. */
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
