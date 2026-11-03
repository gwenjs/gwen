import { describe, expect, it } from "vitest";
import { contextRowNames, prefixViolations, thrownBy } from "./composable-surface.js";

/** Options of {@link runComposableSurfaceSuite}. */
export interface ComposableSurfaceOptions {
  /** Function exports exempt from the prefix rule. A name that is not a function export fails the row. */
  readonly allow?: readonly string[];
}

/** The two vitest functions the rows are registered with. */
export interface RowApi {
  describe(name: string, body: () => void): void;
  it(name: string, body: () => void): void;
}

/** Registers the rows of `entry` through `api`. Split from the public wrapper so a test can record them. */
export function registerComposableSurface(
  entry: Record<string, unknown>,
  options: ComposableSurfaceOptions,
  api: RowApi,
): void {
  const allow = options.allow ?? [];
  api.describe("composable surface", () => {
    api.it("every function export matches a prefix rule", () => {
      const violations = prefixViolations(entry, allow);
      expect(
        violations,
        `function exports without a prefix rule: ${violations.join(", ")}`,
      ).toEqual([]);
    });
    for (const name of contextRowNames(entry)) {
      api.it(`${name} outside any context throws GwenContextError`, () => {
        const composable = entry[name];
        const outcome = thrownBy(() =>
          typeof composable === "function" ? Reflect.apply(composable, undefined, []) : undefined,
        );
        const reason = {
          returned: `${name} returned instead of throwing`,
          other: `${name} threw an error that is not a GwenContextError`,
          "context-error": "",
        }[outcome];
        expect(outcome, reason).toBe("context-error");
      });
    }
  });
}

/**
 * Registers the composable surface rows of `entry` in the current vitest suite: the prefix rule
 * on every function export, and a `GwenContextError` outside any context for each `use*` and `on*`.
 */
export function runComposableSurfaceSuite(
  entry: Record<string, unknown>,
  options: ComposableSurfaceOptions = {},
): void {
  registerComposableSurface(entry, options, { describe, it });
}
