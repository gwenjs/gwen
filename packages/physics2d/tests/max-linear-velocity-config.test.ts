import { describe, expect, it } from "vitest";
import { GwenConfigError } from "@gwenjs/core";
import { normalizeConfig } from "../src/config";

describe("normalizeConfig maxLinearVelocity", () => {
  it("rejects a cap that is not finite or not positive", () => {
    for (const value of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      let caught: unknown;
      try {
        normalizeConfig({ maxLinearVelocity: value });
      } catch (err: unknown) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(GwenConfigError);
      if (!(caught instanceof GwenConfigError)) {
        throw new Error("expected GwenConfigError");
      }
      expect(caught.code).toBe("CORE:INVALID_CONFIG");
      expect(caught.field).toBe("maxLinearVelocity");
    }
    expect(normalizeConfig({}).maxLinearVelocity).toBe(400);
    expect(normalizeConfig({ maxLinearVelocity: 50 }).maxLinearVelocity).toBe(50);
  });
});
