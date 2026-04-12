import { describe, it, expect } from "vitest";
import { GwenContextError, useEngine, engineContext } from "../../src";

describe("GwenContextError — error codes", () => {
  it("has code OUTSIDE_ENGINE when called outside any context", () => {
    engineContext.unset();
    let err: GwenContextError | null = null;
    try {
      useEngine();
    } catch (e) {
      err = e as GwenContextError;
    }
    expect(err).toBeInstanceOf(GwenContextError);
    expect(err!.code).toBe("OUTSIDE_ENGINE");
  });

  it("error message mentions withAsyncContext and capture pattern", () => {
    engineContext.unset();
    let msg = "";
    try {
      useEngine();
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("withAsyncContext");
    expect(msg).toContain("onEnter");
    expect(msg).toContain("@gwenjs/vite");
  });

  it("GwenContextError has a code property", () => {
    const err = new GwenContextError("test", "OUTSIDE_ENGINE");
    expect(err.code).toBe("OUTSIDE_ENGINE");
  });

  it("GwenContextError defaults code to OUTSIDE_ENGINE", () => {
    const err = new GwenContextError("test");
    expect(err.code).toBe("OUTSIDE_ENGINE");
  });
});
