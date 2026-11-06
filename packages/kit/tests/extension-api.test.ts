import { describe, expect, it } from "vitest";
import type { GwenExtensionApi } from "@gwenjs/schema";
import { isExtensionApiCompatible } from "@gwenjs/kit/plugin";

function api(major: number, minor: number): GwenExtensionApi {
  return { major, minor };
}

describe("isExtensionApiCompatible", () => {
  it("isExtensionApiCompatible table", () => {
    expect(typeof isExtensionApiCompatible).toBe("function");
    expect(isExtensionApiCompatible(api(1, 0), api(1, 0))).toBe(true);
    expect(isExtensionApiCompatible(api(1, 0), api(1, 2))).toBe(true);
    expect(isExtensionApiCompatible(api(1, 2), api(1, 0))).toBe(false);
    expect(isExtensionApiCompatible(api(2, 0), api(1, 0))).toBe(false);
    expect(isExtensionApiCompatible(api(1, 0), api(2, 0))).toBe(false);
    expect(isExtensionApiCompatible(api(1, 0), undefined)).toBe(false);
    expect(isExtensionApiCompatible(api(1, 2), api(1, 2))).toBe(true);
  });
});
