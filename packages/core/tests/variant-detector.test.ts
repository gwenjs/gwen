import { describe, it, expect } from "vitest";
import { detectCoreVariant } from "../src/utils/variant-detector";

describe("detectCoreVariant", () => {
  it("returns light when config is empty", () => {
    expect(detectCoreVariant({})).toBe("light");
  });

  it("returns light when modules is empty", () => {
    expect(detectCoreVariant({ modules: [] })).toBe("light");
  });

  // ── legacy plugins[] detection ─────────────────────────────────────────────

  it("returns physics2d when Physics2D plugin is present", () => {
    expect(detectCoreVariant({ plugins: [{ name: "Physics2D" }] })).toBe("physics2d");
  });

  it("returns physics3d when Physics3D plugin is present", () => {
    expect(detectCoreVariant({ plugins: [{ name: "Physics3D" }] })).toBe("physics3d");
  });

  it("physics3d takes priority over physics2d in plugins", () => {
    expect(detectCoreVariant({ plugins: [{ name: "Physics2D" }, { name: "Physics3D" }] })).toBe(
      "physics3d",
    );
  });

  // ── modules[] detection ───────────────────────────────────────────────────

  it("returns physics2d when @gwenjs/physics2d module is present as string", () => {
    expect(detectCoreVariant({ modules: ["@gwenjs/physics2d"] })).toBe("physics2d");
  });

  it("returns physics3d when @gwenjs/physics3d module is present as string", () => {
    expect(detectCoreVariant({ modules: ["@gwenjs/physics3d"] })).toBe("physics3d");
  });

  it("returns physics2d when @gwenjs/physics2d is a tuple [name, opts]", () => {
    expect(detectCoreVariant({ modules: [["@gwenjs/physics2d", { gravity: 9.8 }]] })).toBe(
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

  it("modules and plugins can both contribute — physics3d wins", () => {
    expect(
      detectCoreVariant({
        plugins: [{ name: "Physics2D" }],
        modules: ["@gwenjs/physics3d"],
      }),
    ).toBe("physics3d");
  });
});
