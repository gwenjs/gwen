import type { GwenPlugin } from "@gwenjs/schema";
import { isRecord } from "../json.js";

/** Call one built factory with `options`. A non-function export returns `undefined`. */
export function callExport(
  entry: Record<string, unknown>,
  exportName: string,
  options: unknown,
): unknown {
  const exported: unknown = entry[exportName];
  if (typeof exported !== "function") return undefined;
  return exported(options);
}

/** A factory return `engine.use` can install: a string `name` and a function `setup`. */
export function isPlugin(value: unknown): value is GwenPlugin {
  if (!isRecord(value)) return false;
  if (typeof value.name !== "string") return false;
  return typeof value.setup === "function";
}

/** `code` string on a thrown engine error, or `undefined` when that field is absent. */
export function thrownCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  const code: unknown = error.code;
  if (typeof code !== "string") return undefined;
  return code;
}
