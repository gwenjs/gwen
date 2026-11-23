import { describe, it, expect } from "vitest";
import { detectCoreVariant } from "../src/utils/variant-detector";

describe("detectCoreVariant", () => {
  it("returns light when config is empty", () => {
    expect(detectCoreVariant({})).toBe("light");
  });

  it("returns light when modules is empty", () => {
    expect(detectCoreVariant({ modules: [] })).toBe("light");
  });

  it("a plugin named Physics3D no longer selects a variant", () => {
    expect(detectCoreVariant({ plugins: [{ name: "Physics3D" }] })).toBe("light");
    expect(detectCoreVariant({ plugins: [{ name: "Physics2D" }] })).toBe("light");
  });

  // ── modules[] detection ───────────────────────────────────────────────────

  it("returns physics2d when @gwenjs/physics2d module is present as string", () => {
    expect(detectCoreVariant({ modules: ["@gwenjs/physics2d"] })).toBe("physics2d");
  });

  it("returns physics3d when @gwenjs/physics3d module is present as string", () => {
    expect(detectCoreVariant({ modules: ["@gwenjs/physics3d"] })).toBe("physics3d");
  });

  it("returns physics2d when @gwenjs/physics2d is a tuple [name, opts]", () => {
    expect(detectCoreVariant({ modules: [["@gwenjs/physics2d", { gravity: { y: 9.8 } }]] })).toBe(
      "physics2d",
    );
  });

  it("returns physics3d when @gwenjs/physics3d is a tuple [name, opts]", () => {
    expect(detectCoreVariant({ modules: [["@gwenjs/physics3d", {}]] })).toBe("physics3d");
  });

  it("physics3d takes priority over physics2d in modules", () => {
    expect(detectCoreVariant({ modules: ["@gwenjs/physics2d", "@gwenjs/physics3d"] })).toBe(
      "physics3d",
    );
  });

  it("other modules do not affect variant", () => {
    expect(detectCoreVariant({ modules: ["@gwenjs/input", "@gwenjs/audio"] })).toBe("light");
  });

  it("a declared module wins over a plugin name", () => {
    expect(
      detectCoreVariant({
        plugins: [{ name: "Physics3D" }],
        modules: ["@gwenjs/physics2d"],
      }),
    ).toBe("physics2d");
    expect(
      detectCoreVariant({
        plugins: [{ name: "Physics2D" }],
        modules: ["@gwenjs/physics3d"],
      }),
    ).toBe("physics3d");
  });
});
