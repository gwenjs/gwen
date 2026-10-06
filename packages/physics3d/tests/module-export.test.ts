import { describe, expect, it } from "vitest";

describe("@gwenjs/physics3d module export", () => {
  it("D13 module export: import('@gwenjs/physics3d/module') resolves", async () => {
    const specifier = "@gwenjs/physics3d/module";
    const loaded: { default: { meta: { name: string } } } = await import(specifier);
    expect(loaded).toBeTruthy();
    expect(loaded.default.meta.name).toBe("@gwenjs/physics3d");
  });
});
