/**
 * File access shared by the scanners. Not a lib entry and not exported from the subpath.
 * One strict parse per file; a file that cannot be read or parsed throws.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AutoImport } from "@gwenjs/kit";
import type { Program } from "oxc-parser";
import { GwenError } from "@gwenjs/schema";
import { ViteErrorCodes } from "../error-codes.js";
import { devHint } from "../pipeline/dev-hint.js";
import { parseModule } from "../pipeline/parse.js";
import { createModuleResolver, type ModuleResolver } from "../pipeline/resolve-callee.js";
import type { GwenImportBinding } from "../pipeline/types.js";

/** One parsed file and the resolver that matches its callees by import binding. */
export interface ScannedModule {
  readonly program: Program;
  readonly resolver: ModuleResolver;
}

/**
 * Read and parse one file.
 * An unreadable file (a directory, a permission error) throws `VITE:TRANSFORM_PARSE_FAILED`
 * with the Node error as `cause`. A syntax error throws the same code from `parseModule`.
 * Barrels are not followed: `followed` is empty.
 */
export function readScanned(
  file: string,
  composable: string,
  autoImports: readonly AutoImport[],
): ScannedModule {
  let code: string;
  try {
    code = readFileSync(file, "utf-8");
  } catch (cause) {
    throw new GwenError(ViteErrorCodes.TRANSFORM_PARSE_FAILED, `${file} could not be read.`, {
      composable,
      hint: devHint("Check that the path is a readable file."),
      cause,
    });
  }
  const { program } = parseModule(file, code);
  const resolver = createModuleResolver({
    program,
    code,
    autoImports,
    followed: new Map<string, GwenImportBinding>(),
  });
  return { program, resolver };
}

function hasSuffix(name: string, suffixes: readonly string[]): boolean {
  for (const suffix of suffixes) {
    if (name.endsWith(suffix)) return true;
  }
  return false;
}

/** What `sourceFilesUnder` leaves out besides the files that do not end with a wanted suffix. */
export interface SourceWalkOptions {
  /** Also skip a name containing `.spec.`; declaration and `.test.` files are always skipped. */
  readonly skipSpec?: boolean;
}

/** A declaration file or a test file is not scanned; a `.spec.` file only with `skipSpec`. */
function isSkipped(name: string, skipSpec: boolean): boolean {
  return name.endsWith(".d.ts") || name.includes(".test.") || (skipSpec && name.includes(".spec."));
}

/**
 * Every file under `dir` whose name ends with one of `suffixes`, sorted by full path.
 * A file name ending with `.d.ts` or containing `.test.` is skipped, so is one containing
 * `.spec.` when `options.skipSpec` is set; a skipped file is never read.
 * A name that matches is returned even when it is a directory: reading it then fails loudly.
 * A missing `dir` yields no file.
 */
export function sourceFilesUnder(
  dir: string,
  suffixes: readonly string[],
  options?: SourceWalkOptions,
): string[] {
  const found: string[] = [];
  collect(dir, suffixes, options?.skipSpec === true, found);
  return found.sort();
}

function collect(
  dir: string,
  suffixes: readonly string[],
  skipSpec: boolean,
  found: string[],
): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (hasSuffix(entry.name, suffixes) && !isSkipped(entry.name, skipSpec)) {
      found.push(full);
    } else if (entry.isDirectory()) {
      collect(full, suffixes, skipSpec, found);
    }
  }
}

/**
 * Directory of an `include` glob: the text before the first `**`, without a trailing `/`.
 * An empty string means the glob names no directory.
 */
export function includeBase(pattern: string): string {
  const head = pattern.split("**")[0] ?? "";
  return head.endsWith("/") ? head.slice(0, -1) : head;
}
