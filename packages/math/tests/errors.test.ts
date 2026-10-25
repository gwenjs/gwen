/**
 * colorFromHex throws MathError. The package does not depend on @gwenjs/schema.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { colorFromHex } from "../src/color.js";

declare const __GWEN_DEV__: boolean;

const CODE = "MATH:INVALID_HEX_COLOR";
const SEE = `See https://gwenjs.github.io/gwen/api/errors#math-invalid-hex-color (${CODE})`;
const FIX = "\nFix: Use #RGB, #RGBA, #RRGGBB, or #RRGGBBAA.";

function messageFor(hex: string): string {
  const fix = __GWEN_DEV__ ? FIX : "";
  return `[colorFromHex()] Invalid hex "${hex}".${fix}\n${SEE}`;
}

function thrown(hex: string): Error {
  try {
    colorFromHex(hex);
  } catch (err) {
    if (err instanceof Error) return err;
  }
  throw new Error(`colorFromHex(${JSON.stringify(hex)}) did not throw`);
}

function stringField(value: Error, key: "code" | "composable"): string {
  if (!(key in value)) return "";
  const field = value[key];
  return typeof field === "string" ? field : "";
}

describe("colorFromHex errors", () => {
  it('colorFromHex("#zz") throws MathError MATH:INVALID_HEX_COLOR naming colorFromHex', () => {
    const caught = thrown("#zz");
    expect(caught.message).toBe(messageFor("#zz"));
    expect(caught.name).toBe("MathError");
    expect(stringField(caught, "code")).toBe(CODE);
    expect(stringField(caught, "composable")).toBe("colorFromHex");
    expect(caught.message.includes("Fix:")).toBe(__GWEN_DEV__);

    expect(colorFromHex("#fff")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(colorFromHex("#ffffff")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(colorFromHex("#ffff")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(colorFromHex("#ffffffff")).toEqual({ r: 1, g: 1, b: 1, a: 1 });

    for (const hex of ["#ff", "#fffffff", "", "#ggg"]) {
      const refused = thrown(hex);
      expect(refused.message).toBe(messageFor(hex));
      expect(stringField(refused, "code")).toBe(CODE);
    }
  });

  it("MathError is not a GwenError and math has no schema dependency", () => {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.["@gwenjs/schema"]).toBeUndefined();

    const caught = thrown("#zz");
    expect(caught.name).toBe("MathError");
    expect(Object.getPrototypeOf(Object.getPrototypeOf(caught))).toBe(Error.prototype);
  });
});
