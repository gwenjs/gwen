import { describe, expect, it } from "vitest";
import { isThenable } from "../../src/engine/error-isolation";

describe("isThenable", () => {
  it("accepts a proxy whose get trap serves then and that has no has trap", () => {
    const proxy = new Proxy(
      {},
      { get: (_target, key) => (key === "then" ? () => undefined : undefined) },
    );
    expect(isThenable(proxy)).toBe(true);
  });

  it("accepts a promise and an object with a then method, rejects the rest", () => {
    expect(isThenable(Promise.resolve())).toBe(true);
    expect(isThenable({ then: () => undefined })).toBe(true);
    expect(isThenable({ then: 1 })).toBe(false);
    expect(isThenable({})).toBe(false);
    expect(isThenable(null)).toBe(false);
    expect(isThenable(undefined)).toBe(false);
    expect(isThenable("then")).toBe(false);
  });
});
