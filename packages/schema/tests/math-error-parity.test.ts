/**
 * MathError must render the same grammar string as GwenError.
 * The class lives in @gwenjs/math and does not import this package.
 */
import { describe, expect, it } from "vitest";
import {
  errorDocsUrl,
  GwenError,
  renderGwenMessage,
  type GwenErrorOptions,
} from "../src/errors.js";

interface MathErrorInstance {
  message: string;
  docsUrl: string;
}

type MathErrorCtor = new (
  code: string,
  what: string,
  options?: GwenErrorOptions,
) => MathErrorInstance;

function isMathErrorCtor(value: unknown): value is MathErrorCtor {
  return typeof value === "function";
}

describe("MathError parity", () => {
  it("MathError renders the same message as GwenError for the same code, composable and hint", async () => {
    const mod: Record<string, unknown> = await import("@gwenjs/math");
    expect(mod["MathError"]).toBeTypeOf("function");
    const MathError = mod["MathError"];
    if (!isMathErrorCtor(MathError)) return;

    const code = "MATH:INVALID_HEX_COLOR";
    const what = 'Invalid hex "#zz".';
    const hint = "Use #RGB, #RGBA, #RRGGBB, or #RRGGBBAA.";
    const withHint: GwenErrorOptions = { composable: "colorFromHex", hint };
    const noHint: GwenErrorOptions = { composable: "colorFromHex", hint: undefined };
    const noComposable: GwenErrorOptions = { hint };

    const hinted = new MathError(code, what, withHint);
    expect(Object.hasOwn(hinted, "docsUrl")).toBe(true);
    expect(hinted.message).toBe(renderGwenMessage(code, what, withHint));
    expect(hinted.docsUrl).toBe(errorDocsUrl(code));

    const gwen = new GwenError(code, what, withHint);
    expect(Object.hasOwn(gwen, "docsUrl")).toBe(true);
    expect(gwen.docsUrl).toBe(errorDocsUrl(code));

    const quiet = new MathError(code, what, noHint);
    expect(quiet.message).toBe(renderGwenMessage(code, what, noHint));
    expect(quiet.docsUrl).toBe(errorDocsUrl(code));

    const plain = new MathError(code, what, noComposable);
    expect(plain.message).toBe(renderGwenMessage(code, what, noComposable));
    expect(plain.docsUrl).toBe(errorDocsUrl(code));
  });

  it("new MathError(code, what) matches renderGwenMessage with empty options", async () => {
    const mod: Record<string, unknown> = await import("@gwenjs/math");
    expect(mod["MathError"]).toBeTypeOf("function");
    const MathError = mod["MathError"];
    if (!isMathErrorCtor(MathError)) return;

    const code = "MATH:INVALID_HEX_COLOR";
    const what = 'Invalid hex "#zz".';
    const bare = new MathError(code, what);
    expect(bare.message).toBe(renderGwenMessage(code, what, {}));
  });
});
