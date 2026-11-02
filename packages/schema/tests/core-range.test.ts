/**
 * CORE_RANGE (#281, #96).
 *
 * The caret check goes through `satisfiesCaret` with `CORE_RANGE.slice(1)` as
 * the base, so a different range string fails even when the stamp stays valid.
 */
import { describe, expect, it } from "vitest";
import * as schema from "@gwenjs/schema";
import { isValidSemver, satisfiesCaret } from "../../../scripts/stack/test-support.mjs";
import { stampVersion } from "../../../scripts/stack/version.mjs";

describe("CORE_RANGE", () => {
  it("CORE_RANGE is the #96 range and satisfies 1.0.0-integration stamps", () => {
    expect(typeof schema.CORE_RANGE).toBe("string");
    expect(schema.CORE_RANGE).toBe("^1.0.0-alpha.0");

    const base = schema.CORE_RANGE.slice(1);
    const stamp = stampVersion("abcdef0123456", new Date(Date.UTC(2026, 9, 22, 3, 15, 30)));
    expect(stamp).toBe("1.0.0-integration.20261022031530.gabcdef0");
    expect(isValidSemver(stamp)).toBe(true);
    expect(satisfiesCaret(stamp, base)).toBe(true);
    expect(satisfiesCaret("1.0.0-alpha.0", base)).toBe(true);
    expect(satisfiesCaret("0.2.2", base)).toBe(false);
    expect(satisfiesCaret("0.9.9", base)).toBe(false);
    expect(satisfiesCaret("1.0.0-alpha", base)).toBe(false);
    expect(satisfiesCaret("2.0.0", base)).toBe(false);
  });
});
