import { describe, it, expect } from "vitest";
import { uncheckedAt } from "../src/internal/unchecked.js";

describe("uncheckedAt", () => {
  it("reads the element of a typed array at the given index", () => {
    const view = Float32Array.of(1.5, 2.5, 3.5);
    expect(uncheckedAt(view, 0)).toBe(1.5);
    expect(uncheckedAt(view, 2)).toBe(3.5);
  });

  it("reads the element of a plain array at the given index", () => {
    expect(uncheckedAt(["a", "b"], 1)).toBe("b");
  });
});
