import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as schema from "@gwenjs/schema";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("transform 2d", () => {
  it("exports the transform:2d service key", () => {
    expect(schema.TRANSFORM_2D_SERVICE).toBe("transform:2d");
  });

  it("the transforms module imports no @gwenjs package", () => {
    const file = path.join(pkgRoot, "src", "transforms.ts");
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, "utf8");
    const imports = [...text.matchAll(/from "@gwenjs\//g)].map((match) => match[0]);
    expect(imports).toEqual([]);
  });
});
