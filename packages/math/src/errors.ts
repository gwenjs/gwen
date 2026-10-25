/**
 * Math errors. Local copy of the GWEN message grammar; this package does not import `@gwenjs/schema`.
 */

/** Docs origin. Same value as schema's `GWEN_DOCS_BASE`. */
const GWEN_DOCS_BASE = "https://gwenjs.github.io/gwen";

/** `MATH:INVALID_HEX_COLOR` → `math-invalid-hex-color`. */
function errorDocsAnchor(code: string): string {
  return code.toLowerCase().replace(/[:_]/g, "-");
}

function errorDocsUrl(code: string): string {
  return `${GWEN_DOCS_BASE}/api/errors#${errorDocsAnchor(code)}`;
}

interface MathErrorOptions {
  composable?: string;
  hint?: string | undefined;
}

/** `[where] what`, then `Fix:` when `hint` is set, then `See`. */
function renderMathMessage(code: string, what: string, options: MathErrorOptions): string {
  const where = options.composable !== undefined ? `${options.composable}()` : "GWEN";
  const fix = options.hint !== undefined ? `\nFix: ${options.hint}` : "";
  return `[${where}] ${what}${fix}\nSee ${errorDocsUrl(code)} (${code})`;
}

export const MathErrorCodes = {
  INVALID_HEX_COLOR: "MATH:INVALID_HEX_COLOR",
} as const;

/**
 * Thrown by math helpers. The message matches `GwenError` for the same code,
 * composable, and hint. `docsUrl` is derived from {@link code}.
 */
export class MathError extends Error {
  /** Machine-readable code in `MATH:REASON` form. */
  public readonly code: string;

  /** Public function name, when the throw site set one. */
  public readonly composable: string | undefined;

  /** Fix text. `undefined` when the caller omitted it. */
  public readonly hint: string | undefined;

  /** Docs URL derived from {@link code}. */
  public readonly docsUrl: string;

  constructor(code: string, what: string, options: MathErrorOptions = {}) {
    super(renderMathMessage(code, what, options));
    this.name = "MathError";
    this.code = code;
    this.composable = options.composable;
    this.hint = options.hint;
    this.docsUrl = errorDocsUrl(code);
  }
}
