import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as schema from "@gwenjs/schema";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("introspection contract", () => {
  it("exports the introspection service key", () => {
    expect(schema.GWEN_INTROSPECTION_SERVICE).toBe("introspection");
  });

  it("exports contract version 1", () => {
    expect(schema.GWEN_INTROSPECTION_VERSION).toBe(1);
  });

  it("exports a default maxPageSize of 1000", () => {
    expect(schema.GWEN_INTROSPECTION_DEFAULT_MAX_PAGE).toBe(1000);
  });

  it("exports a frozen code table with PAGE_INVALID", () => {
    expect(typeof schema.GWEN_INTROSPECTION_ERROR_CODES).toBe("object");
    expect(Object.isFrozen(schema.GWEN_INTROSPECTION_ERROR_CODES)).toBe(true);
    expect(schema.GWEN_INTROSPECTION_ERROR_CODES).toEqual({
      PAGE_INVALID: "CORE:INTROSPECTION_PAGE_INVALID",
    });
  });

  it("the introspection module imports no @gwenjs package", () => {
    const file = path.join(pkgRoot, "src", "introspection.ts");
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, "utf8");
    const imports = [...text.matchAll(/["']@gwenjs\//g)].map((match) => match[0]);
    expect(imports).toEqual([]);
  });
});
