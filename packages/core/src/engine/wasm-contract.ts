/**
 * Commit-1 stub. `checkGwenModule` does nothing. The class is a bare `GwenError`.
 */

import { GwenError } from "@gwenjs/schema";
import { CoreErrorCodes } from "./engine-errors.js";

export interface GlueContract {
  readonly buildId: string;
  readonly fingerprint: string;
  readonly names: readonly string[];
  readonly rawExports: readonly string[];
  readonly imports: readonly string[];
}

export type GwenWasmMismatchReason = "build" | "fingerprint" | "exports" | "imports";

export class GwenWasmMismatchError extends GwenError {
  override readonly code: typeof CoreErrorCodes.WASM_GLUE_MISMATCH;
  readonly reason: GwenWasmMismatchReason;
  readonly expected: string;
  readonly actual: string;

  constructor(
    reason: GwenWasmMismatchReason,
    expected: string,
    actual: string,
    detail: { readonly expectedFingerprint: string; readonly actualFingerprint: string },
  ) {
    const code = CoreErrorCodes.WASM_GLUE_MISMATCH;
    super(code, "stub", { composable: "initWasm" });
    this.name = "GwenWasmMismatchError";
    this.code = code;
    this.reason = reason;
    this.expected = expected;
    this.actual = actual;
    void detail;
  }
}

export function checkGwenModule(module: WebAssembly.Module, contract: GlueContract): void {
  void module;
  void contract;
}
