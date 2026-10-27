/**
 * Compare a compiled module to the glue contract from the same build.
 * Internal: the package index exports the error, not `checkGwenModule` (#263).
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

/**
 * The compiled module does not match its glue contract.
 * The engine does not throw this yet (#263).
 */
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
    super(
      code,
      mismatchWhat(reason, expected, actual, detail.expectedFingerprint, detail.actualFingerprint),
      {
        composable: "initWasm",
        hint: __GWEN_DEV__
          ? "Load the binary with the factory of the same build (pnpm build:wasm rebuilds both)."
          : undefined,
      },
    );
    this.name = "GwenWasmMismatchError";
    this.code = code;
    this.reason = reason;
    this.expected = expected;
    this.actual = actual;
  }
}

function mismatchWhat(
  reason: GwenWasmMismatchReason,
  expected: string,
  actual: string,
  expectedFingerprint: string,
  actualFingerprint: string,
): string {
  if (reason === "build") {
    return (
      "The WASM binary does not come from the same build as its glue: " +
      `glue ${expected} (${expectedFingerprint}), binary ${actual} (${actualFingerprint}).`
    );
  }
  if (reason === "fingerprint") {
    return `The WASM binary fingerprint does not match its glue: glue ${expected}, binary ${actual}.`;
  }
  if (reason === "exports") {
    return `The WASM binary is missing raw exports: ${expected}.`;
  }
  return `The WASM binary imports ${actual}, which is outside its glue contract.`;
}

function sectionTexts(module: WebAssembly.Module, name: string): string[] {
  return WebAssembly.Module.customSections(module, name).map((section) =>
    new TextDecoder().decode(section),
  );
}

/** Success only. A later call with the same Module and the same contract object skips the reads. */
const checked = new WeakMap<WebAssembly.Module, GlueContract>();

/**
 * Reject a module that is not the binary this glue was built with.
 * Order: build, fingerprint, exports, imports. No instance.
 */
export function checkGwenModule(module: WebAssembly.Module, contract: GlueContract): void {
  if (checked.get(module) === contract) return;

  const buildSections = sectionTexts(module, "gwen.build");
  const fingerprintSections = sectionTexts(module, "gwen.fingerprint");
  const fingerprintText = fingerprintSections.length === 1 ? fingerprintSections[0] : undefined;
  const actualFingerprint =
    fingerprintText ??
    (fingerprintSections.length === 0
      ? "<no gwen.fingerprint section>"
      : `<${fingerprintSections.length} gwen.fingerprint sections>`);

  const fail = (reason: GwenWasmMismatchReason, expected: string, actual: string): never => {
    throw new GwenWasmMismatchError(reason, expected, actual, {
      expectedFingerprint: contract.fingerprint,
      actualFingerprint,
    });
  };

  const buildText = buildSections.length === 1 ? buildSections[0] : undefined;
  if (buildText === undefined) {
    throw fail(
      "build",
      contract.buildId,
      buildSections.length === 0
        ? "<no gwen.build section>"
        : `<${buildSections.length} gwen.build sections>`,
    );
  }
  if (buildText !== contract.buildId) {
    fail("build", contract.buildId, buildText);
  }

  if (fingerprintText === undefined) {
    throw fail("fingerprint", contract.fingerprint, actualFingerprint);
  }
  if (fingerprintText !== contract.fingerprint) {
    fail("fingerprint", contract.fingerprint, fingerprintText);
  }

  const exported = new Set(WebAssembly.Module.exports(module).map((item) => item.name));
  const missing: string[] = [];
  for (const name of contract.rawExports) {
    if (!exported.has(name)) missing.push(name);
  }
  if (missing.length > 0) {
    fail("exports", missing.join(","), "<absent>");
  }

  const allowed = new Set(contract.imports);
  const extra: string[] = [];
  for (const item of WebAssembly.Module.imports(module)) {
    if (!allowed.has(item.name)) extra.push(item.name);
  }
  if (extra.length > 0) {
    fail("imports", "<not in contract>", extra.join(","));
  }

  checked.set(module, contract);
}
