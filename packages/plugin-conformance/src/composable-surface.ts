import { GwenContextError } from "@gwenjs/kit";

/** Prefix every function export of a public entry must start with. */
export const PREFIX_RULE = /^(define|use|on|place|create|get|with)[A-Z]/;

/** Exports that must throw `GwenContextError` outside a context. */
const CONTEXT_RULE = /^(use|on)[A-Z]/;

/** What a call did: it returned, it threw something else, or it threw a `GwenContextError`. */
export type ThrowOutcome = "returned" | "other" | "context-error";

// A class is detected by its source text, which starts with `class`.
function isClassExport(value: unknown): boolean {
  return typeof value === "function" && /^class\b/.test(Function.prototype.toString.call(value));
}

/** Sorted names of the function exports of `entry`, classes left out. */
export function functionExports(entry: Record<string, unknown>): string[] {
  return Object.entries(entry)
    .filter(([, value]) => typeof value === "function" && !isClassExport(value))
    .map(([name]) => name)
    .sort();
}

/**
 * One message per problem: each function export that breaks {@link PREFIX_RULE} and is not
 * in `allow`, then each `allow` entry that is not a function export (a stale entry).
 */
export function prefixViolations(
  entry: Record<string, unknown>,
  allow: readonly string[],
): string[] {
  const exported = functionExports(entry);
  const unprefixed = exported.filter((name) => !PREFIX_RULE.test(name) && !allow.includes(name));
  const stale = allow.filter((name) => !exported.includes(name));
  return [...unprefixed, ...stale.map((name) => `allow entry ${JSON.stringify(name)} is stale`)];
}

/** Sorted `use*` and `on*` function exports: the ones a context row is registered for. */
export function contextRowNames(entry: Record<string, unknown>): string[] {
  return functionExports(entry).filter((name) => CONTEXT_RULE.test(name));
}

/** Calls `fn` and says whether it returned, threw a `GwenContextError`, or threw anything else. */
export function thrownBy(fn: () => unknown): ThrowOutcome {
  try {
    fn();
  } catch (error) {
    return error instanceof GwenContextError ? "context-error" : "other";
  }
  return "returned";
}
