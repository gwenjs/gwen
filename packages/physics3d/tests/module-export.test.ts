import { describe, expect, it } from "vitest";

describe("@gwenjs/physics3d module export", () => {
  it.fails("D13 module export: import('@gwenjs/physics3d/module') resolves", async () => {
    const specifier = "@gwenjs/physics3d/module";
    const loaded: unknown = await import(specifier);
    expect(loaded).toBeTruthy();
  });
});
