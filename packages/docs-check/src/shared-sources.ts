import ts from "typescript";

type ReadSourceFile = ts.CompilerHost["getSourceFile"];

/**
 * SKELETON: never hits. Every read parses again and `parses` counts every read.
 */
export class SourceCache {
  private count = 0;

  /** Number of real parses made through this cache. */
  get parses(): number {
    return this.count;
  }

  /** Wrap the read-from-disk fallback of a compiler host. */
  through(read: ReadSourceFile): ReadSourceFile {
    return (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
      this.count += 1;
      return read(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
    };
  }

  /** Forget every cached file. */
  clear(): void {}
}
