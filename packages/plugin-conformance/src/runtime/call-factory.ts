import { CoreErrorCodes } from "@gwenjs/core";
import type { GwenPlugin } from "@gwenjs/schema";
import { isRecord } from "../json.js";

/**
 * Call one built factory with `options`.
 * A non-function export returns `undefined`.
 * A throw returns `undefined` so later checks stay silent.
 * Shape reports that throw (`packages/plugin-conformance/src/runtime/check-shape.ts`).
 */
export function callExport(
  entry: Record<string, unknown>,
  exportName: string,
  options: unknown,
): unknown {
  const exported: unknown = entry[exportName];
  if (typeof exported !== "function") return undefined;
  try {
    return exported(options);
  } catch {
    return undefined;
  }
}

/** True when `code` is one of the engine provide rejection codes. */
export function isProvideCode(code: string | undefined): code is string {
  if (code === undefined) return false;
  return (
    code === CoreErrorCodes.PLUGIN_PROVIDE_DUPLICATE ||
    code === CoreErrorCodes.PLUGIN_PROVIDE_MISSING ||
    code === CoreErrorCodes.PLUGIN_PROVIDE_UNDECLARED
  );
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
