/**
 * defineLayers returns the same object and warns when two values share a bit.
 */

import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";

describe("defineLayers", () => {
  it("returns its input and keeps the literal keys", () => {
    expect(typeof api.defineLayers).toBe("function");
    const warnings: string[] = [];
    const previous = console.warn;
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };
    try {
      const distinct = { ground: 1, player: 2 };
      expect(api.defineLayers(distinct)).toBe(distinct);
      expect(warnings).toEqual([]);
      const shared = { a: 1, b: 3 };
      const result = api.defineLayers(shared);
      expect(result).toBe(shared);
      expect(result).toEqual({ a: 1, b: 3 });
      expect(Object.keys(result)).toEqual(["a", "b"]);
      expect(warnings).toEqual([
        "[gwen:physics-core] defineLayers: layers at index 0 and 1 share bits (1 & 3 = 1).",
      ]);
    } finally {
      console.warn = previous;
    }
  });
});
