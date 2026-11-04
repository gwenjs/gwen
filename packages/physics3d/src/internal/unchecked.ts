import type { Physics3DWasmBridge } from "../plugin/bridge";

/**
 * Reads `array[index]` where the caller's bound or length check covers the index.
 *
 * `noUncheckedIndexedAccess` types every indexed read as `T | undefined`. A non-null
 * assertion would hide the read and a new branch would add work in a hot path. This plain
 * function inlines to the read itself: no branch, no allocation. It is not exported from
 * the package entry.
 *
 * @param array - Array or typed array being read.
 * @param index - Index the caller's check covers. A read past the end still gives `undefined`.
 * @returns The element at `index`, typed without `undefined`.
 * @internal
 */
export function uncheckedAt<T>(array: ArrayLike<T>, index: number): T {
  return array[index] as T; // boundary: the caller reads under its own loop bound or length check; a short typed array reads undefined here as it did under the former assertion
}

/**
 * Types the WASM export table of a wasm-mode body, collider or query call.
 *
 * `bridge` is `ctx.wasmBridge`, read at the call. The same object comes back, so an export
 * keeps its receiver. A missing bridge still throws a `TypeError` at the first export read,
 * which `callPhysics3DExport` maps as before. No branch, no allocation. It is not exported
 * from the package entry.
 *
 * @param bridge - The bridge stored on the plugin context.
 * @returns The same bridge, with every export typed as present.
 *   Widened: `Required<…>` makes an export that a build omits look present. A test of presence
 *   (the `wasmBulk` check in collider-management.ts) stays a runtime test.
 * @internal
 */
export function liveWasmBridge(bridge: Physics3DWasmBridge | null): Required<Physics3DWasmBridge> {
  return bridge as Required<Physics3DWasmBridge>; // boundary: drops both `null` and the optional markers of the export table: the caller reads the export unguarded, so a null bridge or a build that omits an export fails at the call, as the former `!` did
}
