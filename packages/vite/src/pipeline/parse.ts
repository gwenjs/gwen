/**
 * One parse per module. Callers must not swallow a failure.
 * Every parse in `packages/vite/src` goes through `parseModule`, except the counts of `plugins/dev-strip.ts`.
 */

import { parseSync, type Comment, type ParseResult, type Program } from "oxc-parser";
import { GwenError } from "@gwenjs/schema";
import { ViteErrorCodes } from "../error-codes.js";
import { devHint } from "./dev-hint.js";

const PARSE_HINT = "Fix the syntax error; the GWEN build never skips a module it cannot parse.";

const SOURCE_FILE = /\.(ts|tsx|js|jsx|mts|cts)$/;

/** Path used for the dialect. A query is not part of the extension. */
export function pathWithoutQuery(id: string): string {
  const queryAt = id.indexOf("?");
  if (queryAt < 0) return id;
  return id.slice(0, queryAt);
}

/** A script the pipeline can parse. A declaration file is not one. A query is not part of the extension. */
export function isScriptModule(id: string): boolean {
  const path = pathWithoutQuery(id);
  if (path.endsWith(".d.ts")) return false;
  return SOURCE_FILE.test(path);
}

/** 1-based line and 1-based column. A line break is `\n` only. */
export function lineColumn(code: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  const end = offset < code.length ? offset : code.length;
  for (let index = 0; index < end; index += 1) {
    if (code.charCodeAt(index) === 10) {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function failParse(id: string, code: string, offset: number, message: string): never {
  const place = lineColumn(code, offset);
  const error = new GwenError(
    ViteErrorCodes.TRANSFORM_PARSE_FAILED,
    `${id}:${place.line}:${place.column} ${message}.`,
    { composable: "gwen", hint: devHint(PARSE_HINT) },
  );
  // Vite's `generateCodeFrame` and `originalPositionFor` take a 0-based column.
  // The message keeps the editor-style 1-based column.
  const located = Object.assign(error, {
    loc: { file: id, line: place.line, column: place.column - 1 },
  });
  throw located;
}

function thrownMessage(caught: unknown): string {
  if (caught instanceof Error) return caught.message;
  return "The parser threw.";
}

/**
 * Parse `code` in the dialect of the path with its query stripped.
 * The message and `loc.file` keep the full `id`. The first parser error fails the build.
 */
export function parseModule(id: string, code: string): { program: Program; comments: Comment[] } {
  let result: ParseResult;
  try {
    result = parseSync(pathWithoutQuery(id), code);
  } catch (caught) {
    failParse(id, code, 0, thrownMessage(caught));
  }
  const first = result.errors[0];
  if (first !== undefined) {
    const label = first.labels[0];
    const offset = label === undefined ? 0 : label.start;
    failParse(id, code, offset, first.message);
  }
  return { program: result.program, comments: result.comments };
}
