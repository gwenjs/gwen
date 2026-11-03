import { describe, expect, it } from "vitest";

/** Options of {@link runComposableSurfaceSuite}. */
export interface ComposableSurfaceOptions {
  /** Function exports exempt from the prefix rule. */
  readonly allow?: readonly string[];
}

/** The two vitest functions the rows are registered with. */
export interface RowApi {
  describe(name: string, body: () => void): void;
  it(name: string, body: () => void): void;
}

const NOT_IMPLEMENTED = "skeleton: rule not implemented";

export function registerComposableSurface(
  entry: Record<string, unknown>,
  _options: ComposableSurfaceOptions,
  api: RowApi,
): void {
  api.describe("composable surface", () => {
    api.it("every function export matches a prefix rule", () => {
      expect(true, NOT_IMPLEMENTED).toBe(false);
    });
    for (const name of Object.keys(entry).filter((key) => /^(use|on)[A-Z]/.test(key))) {
      api.it(`${name} outside any context throws GwenContextError`, () => {
        expect(true, NOT_IMPLEMENTED).toBe(false);
      });
    }
  });
}

/** Registers the composable surface rows of `entry` in the current vitest suite (skeleton). */
export function runComposableSurfaceSuite(
  entry: Record<string, unknown>,
  options: ComposableSurfaceOptions = {},
): void {
  registerComposableSurface(entry, options, { describe, it });
}
