/**
 * @fileoverview Map a rejected physics3d WASM export onto a typed error.
 *
 * Wrap an export only when the Rust side can reject it. A call that cannot
 * reject (event count and pointer, cc buffer pointer, constants) is made
 * directly. The TypeScript registry checks stay outside this helper and run first.
 */

import type { GwenWasmError } from "@gwenjs/core";
import { poisonWasmBridge, toGwenWasmError } from "@gwenjs/core/internal";
import { GwenError } from "@gwenjs/schema";
import type { PluginContext } from "./plugin-context";

/** Add a period unless the Rust text already ends with `.`, `?`, or `!`. */
function toSentence(text: string): string {
  return text.endsWith(".") || text.endsWith("?") || text.endsWith("!") ? text : `${text}.`;
}

/** `GwenWasmError` from core. The name check stays: several test mocks omit the class. */
function isSentencedWasmError(value: unknown): value is GwenWasmError<string> {
  if (typeof value !== "object" || value === null) return false;
  if (!("name" in value) || value.name !== "GwenWasmError") return false;
  if (!("code" in value) || typeof value.code !== "string") return false;
  if (!("message" in value) || typeof value.message !== "string") return false;
  if (!("exportName" in value) || typeof value.exportName !== "string") return false;
  if (!("cause" in value) || typeof value.constructor !== "function") return false;
  return true;
}

/** True for a `PHYSICS3D:` code. `CORE:` codes are already known to `toGwenWasmError`. */
export function isPhysics3DWasmCode(code: unknown): code is `PHYSICS3D:${string}` {
  return typeof code === "string" && code.startsWith("PHYSICS3D:");
}

/**
 * Map a value thrown by a physics3d export.
 *
 * A coded `Error` becomes `GwenWasmError` with its code, the export name and the
 * original error as `cause`. A WASM trap becomes `GwenWasmPanicError` and poisons the
 * shared bridge. Anything else is returned as it was.
 */
export function mapPhysics3DError(ctx: PluginContext, err: unknown, exportName: string): unknown {
  if (isSentencedWasmError(err)) return err;
  const mapped = toGwenWasmError(
    err,
    exportName,
    (cause) => {
      const bridge = ctx.bridgeRuntime;
      if (bridge !== null) poisonWasmBridge(bridge, cause);
    },
    isPhysics3DWasmCode,
  );
  if (!isSentencedWasmError(mapped)) return mapped;
  if (!(err instanceof Error)) return mapped;
  const WasmError = mapped.constructor as typeof GwenWasmError;
  return new WasmError(mapped.code, toSentence(err.message), mapped.exportName, mapped.cause);
}

/**
 * Run one fallible physics3d export. Rethrows a mapped error.
 * Per-frame calls use `try` and `mapPhysics3DError` directly, without a closure.
 */
export function callPhysics3DExport<T>(ctx: PluginContext, exportName: string, run: () => T): T {
  try {
    return run();
  } catch (err: unknown) {
    throw mapPhysics3DError(ctx, err, exportName);
  }
}

/** True when `err` is a coded error carrying exactly `code`. Branch on the code, never the message. */
export function hasPhysics3DCode(err: unknown, code: string): err is GwenError {
  return err instanceof GwenError && err.code === code;
}
