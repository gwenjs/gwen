/** Pure rules of the composable surface suite (skeleton: nothing is found yet). */

/** Prefix every function export of a public entry must start with. */
export const PREFIX_RULE = /^(define|use|on|place|create|get|with)[A-Z]/;

/** What a call did: it returned, it threw something else, or it threw a `GwenContextError`. */
export type ThrowOutcome = "returned" | "other" | "context-error";

export function functionExports(_entry: Record<string, unknown>): string[] {
  return [];
}

export function prefixViolations(
  _entry: Record<string, unknown>,
  _allow: readonly string[],
): string[] {
  return [];
}

export function contextRowNames(_entry: Record<string, unknown>): string[] {
  return [];
}

export function thrownBy(_fn: () => unknown): ThrowOutcome {
  return "returned";
}
